import { execSync, spawn, type ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { app } from "electron";
import { z } from "zod";
import { type CodexReasoningEffort } from "@openclawdex/shared";
import type {
  AgentSession,
  ContextUsage,
  ImageInput,
  RequestResolution,
  SessionEvent,
} from "./agent-session";

/** Best-effort cleanup of a single tempfile. Never throws. */
function safeUnlink(p: string): void {
  try { fs.unlinkSync(p); } catch { /* ignore */ }
}

export function isCodexInstalled(): boolean {
  try {
    execSync("which codex", { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

export type CodexSessionOptions = {
  resumeThreadId?: string;
  cwd?: string;
  model?: string;
  effort?: CodexReasoningEffort;
};

const JsonRpcResponse = z.object({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});

const JsonRpcNotification = z.object({
  method: z.string(),
  params: z.unknown().optional(),
});

type RpcPending = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type TurnWaiter = {
  onEvent: (e: SessionEvent) => void;
  resolve: () => void;
  reject: (error: Error) => void;
  turnId: string | null;
};

type CodexInputItem = { type: "text"; text: string } | { type: "localImage"; path: string };

export class CodexSession implements AgentSession {
  readonly provider = "codex" as const;

  private readonly cwd: string | undefined;
  private readonly modelLabel: string;
  private readonly effort: CodexReasoningEffort | undefined;

  private readonly child: ChildProcessWithoutNullStreams;
  private stdoutBuf = "";
  private rpcId = 1;
  private readonly pendingRpc = new Map<number, RpcPending>();

  private initPromise: Promise<void>;
  private initResolve!: () => void;
  private initReject!: (error: Error) => void;

  private threadId: string | null;
  private initEmitted = false;
  private currentTurn: TurnWaiter | null = null;

  private queue: Array<{
    input: CodexInputItem[];
    onEvent: (e: SessionEvent) => void;
    tempImagePaths: string[];
  }> = [];
  private draining = false;
  private closed = false;

  constructor(opts?: CodexSessionOptions) {
    this.cwd = opts?.cwd;
    this.modelLabel = opts?.model ?? "codex";
    this.effort = opts?.effort;
    this.threadId = opts?.resumeThreadId ?? null;

    this.initPromise = new Promise<void>((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
    });

    this.child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk));
    this.child.stderr.on("data", () => {
      // app-server occasionally writes progress text to stderr; ignore.
    });
    this.child.on("error", (err) => this.failSession(new Error(`codex app-server spawn failed: ${err.message}`)));
    this.child.on("exit", (code, signal) => {
      const detail = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      this.failSession(new Error(`codex app-server exited (${detail})`));
    });

    void this.initialize();
  }

  private failSession(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.initReject(error);
    for (const [id, pending] of this.pendingRpc) {
      pending.reject(new Error(`RPC ${id} (${pending.method}) failed: ${error.message}`));
    }
    this.pendingRpc.clear();
    if (this.currentTurn) {
      this.currentTurn.reject(error);
      this.currentTurn = null;
    }
  }

  private onStdout(chunk: Buffer): void {
    this.stdoutBuf += chunk.toString("utf-8");
    let nl: number;
    while ((nl = this.stdoutBuf.indexOf("\n")) >= 0) {
      const line = this.stdoutBuf.slice(0, nl).trim();
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      if (!line) continue;

      let parsedUnknown: unknown;
      try {
        parsedUnknown = JSON.parse(line);
      } catch {
        continue;
      }

      const asResponse = JsonRpcResponse.safeParse(parsedUnknown);
      if (asResponse.success) {
        this.handleRpcResponse(asResponse.data);
        continue;
      }

      const asNotif = JsonRpcNotification.safeParse(parsedUnknown);
      if (asNotif.success) {
        this.handleNotification(asNotif.data.method, asNotif.data.params);
        continue;
      }

      // Some builds may emit event objects with `type` instead of JSON-RPC notification envelope.
      if (
        parsedUnknown &&
        typeof parsedUnknown === "object" &&
        typeof (parsedUnknown as Record<string, unknown>).type === "string"
      ) {
        const event = parsedUnknown as Record<string, unknown>;
        this.handleNotification(String(event.type), event);
        continue;
      }

      // Ignore unknown notification shapes for forward compatibility.
    }
  }

  private handleRpcResponse(msg: z.infer<typeof JsonRpcResponse>): void {
    const pending = this.pendingRpc.get(msg.id);
    if (!pending) return;
    this.pendingRpc.delete(msg.id);
    if (msg.error) {
      pending.reject(
        new Error(
          `${pending.method} failed: ${msg.error.message ?? `RPC ${msg.id} failed`}`,
        ),
      );
      return;
    }
    pending.resolve(msg.result);
  }

  private normalizeMethod(method: string): string {
    return method.replace(/\//g, ".");
  }

  private pickTextDelta(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, unknown>;
    const candidates = [
      p.text,
      p.delta,
      (p.delta as Record<string, unknown> | undefined)?.text,
      (p.params as Record<string, unknown> | undefined)?.text,
      (p.params as Record<string, unknown> | undefined)?.delta,
      ((p.params as Record<string, unknown> | undefined)?.delta as Record<string, unknown> | undefined)?.text,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.length > 0) return c;
    }
    return null;
  }

  private pickItem(payload: unknown): Record<string, unknown> | null {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, unknown>;
    const item = (p.item ?? (p.params as Record<string, unknown> | undefined)?.item) as unknown;
    if (!item || typeof item !== "object") return null;
    return item as Record<string, unknown>;
  }

  private handleNotification(methodRaw: string, params: unknown): void {
    const method = this.normalizeMethod(methodRaw);

    if (method === "item.agentMessage.delta" || method === "item.agent_message.delta") {
      const delta = this.pickTextDelta(params);
      if (delta && this.currentTurn) {
        this.currentTurn.onEvent({ kind: "text_delta", text: delta });
      }
      return;
    }

    if (method === "item.started" || method === "item.updated" || method === "item.completed") {
      const rawItem = this.pickItem(params);
      if (!rawItem) return;
      const item = rawItem;
      const itemType = typeof item.type === "string" ? item.type : null;
      if (!itemType || !this.currentTurn) return;

      if (itemType === "agent_message" && method === "item.completed") {
        const text = typeof item.text === "string" ? item.text : "";
        if (text) this.currentTurn.onEvent({ kind: "text_delta", text });
        return;
      }

      if (itemType === "command_execution") {
        this.currentTurn.onEvent({
          kind: "tool_use",
          toolUseId: typeof item.id === "string" ? item.id : undefined,
          toolName: "shell",
          toolInput: {
            command: item.command,
            output: item.aggregated_output,
            exit_code: item.exit_code,
          } as Record<string, unknown>,
        });
        return;
      }

      if (itemType === "file_change" && method === "item.completed") {
        this.currentTurn.onEvent({
          kind: "tool_use",
          toolUseId: typeof item.id === "string" ? item.id : undefined,
          toolName: "apply_patch",
          toolInput: {
            changes: item.changes,
            status: item.status,
          } as Record<string, unknown>,
        });
        return;
      }

      if (itemType === "mcp_tool_call") {
        this.currentTurn.onEvent({
          kind: "tool_use",
          toolUseId: typeof item.id === "string" ? item.id : undefined,
          toolName: `${String(item.server ?? "mcp")}.${String(item.tool ?? "tool")}`,
          toolInput: ((item.arguments as Record<string, unknown>) ?? {}) as Record<string, unknown>,
        });
        return;
      }

      if (itemType === "web_search") {
        this.currentTurn.onEvent({
          kind: "tool_use",
          toolUseId: typeof item.id === "string" ? item.id : undefined,
          toolName: "web_search",
          toolInput: { query: item.query } as Record<string, unknown>,
        });
        return;
      }

      if (itemType === "todo_list") {
        this.currentTurn.onEvent({
          kind: "tool_use",
          toolUseId: typeof item.id === "string" ? item.id : undefined,
          toolName: "update_plan",
          toolInput: { items: item.items } as Record<string, unknown>,
        });
        return;
      }

      if (itemType === "error" && method === "item.completed") {
        const msg = typeof item.message === "string" ? item.message : "Unknown Codex error";
        this.currentTurn.onEvent({ kind: "error", message: msg });
      }
      return;
    }

    if (method === "turn.started") return;

    if (method === "turn.completed") {
      if (!this.currentTurn) return;
      const turn = this.currentTurn;
      this.currentTurn = null;
      turn.resolve();
      return;
    }

    if (method === "turn.failed") {
      const msg =
        (params && typeof params === "object" && typeof (params as Record<string, unknown>).error === "object"
          ? String(((params as Record<string, unknown>).error as Record<string, unknown>).message ?? "Turn failed")
          : "Turn failed");
      if (this.currentTurn) {
        const turn = this.currentTurn;
        this.currentTurn = null;
        turn.reject(new Error(msg));
      }
      return;
    }

    if (method === "error" && this.currentTurn) {
      const msg = this.pickTextDelta(params) ?? "Codex stream error";
      this.currentTurn.onEvent({ kind: "error", message: msg });
    }
  }

  private writeJsonLine(message: unknown): Promise<void> {
    if (this.closed) return Promise.reject(new Error("Codex session is closed"));
    const payload = JSON.stringify(message) + "\n";
    return new Promise<void>((resolve, reject) => {
      this.child.stdin.write(payload, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private rpc(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Codex session is closed"));
    const id = this.rpcId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise<unknown>((resolve, reject) => {
      this.pendingRpc.set(id, { method, resolve, reject });
      this.child.stdin.write(payload, (err) => {
        if (!err) return;
        this.pendingRpc.delete(id);
        reject(err);
      });
    });
  }

  private async initialize(): Promise<void> {
    try {
      await this.rpc("initialize", {
        clientInfo: {
          name: "openclawdex",
          version: app.getVersion(),
        },
        capabilities: { experimentalApi: true },
      });
      await this.writeJsonLine({ jsonrpc: "2.0", method: "initialized" });
      this.initResolve();
    } catch (err) {
      this.initReject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async ensureThreadReady(onEvent: (e: SessionEvent) => void): Promise<void> {
    await this.initPromise;
    if (this.threadId) {
      // Resume explicitly so app-server loads thread state.
      await this.rpc("thread/resume", { threadId: this.threadId });
      if (!this.initEmitted) {
        this.initEmitted = true;
        onEvent({ kind: "init", sessionId: this.threadId, model: this.modelLabel });
      }
      return;
    }

    const result = await this.rpc("thread/start", {
      ...(this.modelLabel && { model: this.modelLabel }),
      ...(this.cwd && { cwd: this.cwd }),
      approvalPolicy: "never",
      sandbox: "workspace-write",
    });
    const threadId =
      result && typeof result === "object"
        ? ((result as Record<string, unknown>).thread as Record<string, unknown> | undefined)?.id
        : undefined;
    if (typeof threadId !== "string" || threadId.length === 0) {
      throw new Error("thread/start response missing thread.id");
    }
    this.threadId = threadId;
    if (!this.initEmitted) {
      this.initEmitted = true;
      onEvent({ kind: "init", sessionId: threadId, model: this.modelLabel });
    }
  }

  private imagesToInput(text: string, images: ImageInput[]): { input: CodexInputItem[]; tempPaths: string[] } {
    const items: CodexInputItem[] = [];
    const tempPaths: string[] = [];
    for (const img of images) {
      if (img.path) {
        items.push({ type: "localImage", path: img.path });
        continue;
      }
      const ext = img.mediaType.split("/")[1] ?? "png";
      const p = path.join(os.tmpdir(), `openclawdex-codex-${randomUUID()}.${ext}`);
      fs.writeFileSync(p, Buffer.from(img.base64, "base64"));
      tempPaths.push(p);
      items.push({ type: "localImage", path: p });
    }
    if (text) items.push({ type: "text", text });
    return { input: items, tempPaths };
  }

  send(
    message: string,
    images: ImageInput[] | undefined,
    onEvent: (e: SessionEvent) => void,
  ): void {
    let input: CodexInputItem[] = [{ type: "text", text: message }];
    let tempImagePaths: string[] = [];
    if (images && images.length > 0) {
      const prepared = this.imagesToInput(message, images);
      input = prepared.input;
      tempImagePaths = prepared.tempPaths;
    }

    this.queue.push({ input, onEvent, tempImagePaths });
    if (!this.draining) {
      this.draining = true;
      void this.driveQueue();
    }
  }

  private async driveQueue(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const { input, onEvent, tempImagePaths } = this.queue.shift()!;
        try {
          await this.runOneTurn(input, onEvent);
        } finally {
          for (const p of tempImagePaths) safeUnlink(p);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async runOneTurn(
    input: CodexInputItem[],
    onEvent: (e: SessionEvent) => void,
  ): Promise<void> {
    const lastUsage: ContextUsage | null = null;
    let turnError: string | null = null;

    try {
      await this.ensureThreadReady(onEvent);
      if (!this.threadId) throw new Error("Missing thread id");

      await new Promise<void>((resolve, reject) => {
        this.currentTurn = { onEvent, resolve, reject, turnId: null };
        void this.rpc("turn/start", {
          threadId: this.threadId,
          input,
          ...(this.cwd && { cwd: this.cwd }),
          ...(this.modelLabel && { model: this.modelLabel }),
          ...(this.effort && { effort: this.effort }),
          approvalPolicy: "never",
          sandboxPolicy: {
            type: "workspaceWrite",
            networkAccess: true,
            ...(this.cwd && { writableRoots: [this.cwd] }),
          },
          sandbox: "workspace-write",
        }).then((result) => {
          const turnId =
            result && typeof result === "object"
              ? ((result as Record<string, unknown>).turn as Record<string, unknown> | undefined)?.id
              : undefined;
          if (this.currentTurn && typeof turnId === "string") {
            this.currentTurn.turnId = turnId;
          }
        }).catch((err) => {
          if (this.currentTurn) this.currentTurn = null;
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      });
    } catch (err) {
      turnError = err instanceof Error ? err.message : String(err);
    }

    onEvent({
      kind: "result",
      costUsd: null,
      durationMs: null,
      isError: turnError !== null,
      contextUsage: lastUsage,
      pendingRequest: null,
    });
    if (turnError) onEvent({ kind: "error", message: turnError });
    onEvent({ kind: "done" });
  }

  resolveRequest(_resolution: RequestResolution): void {
    // Codex doesn't emit any PendingRequest variants today. When we wire
    // app-server approval requests, this will dispatch on
    // `resolution.kind` and reply on the paused JSON-RPC call.
  }

  async interrupt(): Promise<void> {
    if (!this.threadId || !this.currentTurn?.turnId) return;
    // Fire and forget — don't block session teardown on the server's response.
    this.rpc("turn/interrupt", {
      threadId: this.threadId,
      turnId: this.currentTurn.turnId,
    }).catch(() => {
      // Best effort.
    });
  }

  close(): void {
    this.closed = true;
    for (const entry of this.queue) {
      for (const p of entry.tempImagePaths) safeUnlink(p);
    }
    this.queue = [];
    this.currentTurn = null;
    for (const [, pending] of this.pendingRpc) {
      pending.reject(new Error("Codex session closed"));
    }
    this.pendingRpc.clear();
    try {
      this.child.kill();
    } catch {
      // ignore
    }
  }
}

