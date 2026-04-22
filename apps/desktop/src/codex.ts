import { execSync, spawn, type ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { app } from "electron";
import { z } from "zod";
import { type CodexReasoningEffort, type UserMode } from "@openclawdex/shared";
import type {
  AgentSession,
  ContextUsage,
  ImageInput,
  PendingRequest,
  RequestResolution,
  SessionEvent,
} from "./agent-session";
import { codexModeOptions, codexTurnContextToUserMode } from "./user-mode";
import { codexDisplayCommand } from "./command-display";

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
  userMode?: UserMode;
};

// JSON-RPC ids can be strings or numbers per spec. We send integers;
// app-server echoes them back, but server-initiated requests can use
// either — relax here so the schema matches whatever comes over.
const JsonRpcId = z.union([z.string(), z.number()]);

const JsonRpcResponse = z.object({
  id: JsonRpcId,
  result: z.unknown().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});

const JsonRpcNotification = z.object({
  method: z.string(),
  params: z.unknown().optional(),
});

// Server-initiated RPC request (e.g. item/tool/requestUserInput). Has
// BOTH `id` and `method` — distinguished from a response (id without
// method) and a notification (method without id).
const JsonRpcServerRequest = z.object({
  id: JsonRpcId,
  method: z.string(),
  params: z.unknown().optional(),
});

const CodexUserInputOption = z.object({
  label: z.string(),
  description: z.string().optional(),
});

const CodexUserInputQuestion = z.object({
  id: z.string(),
  header: z.string().optional(),
  question: z.string(),
  options: z.array(CodexUserInputOption),
  multiSelect: z.boolean().optional(),
});

const CodexUserInputRequestParams = z.object({
  questions: z.array(CodexUserInputQuestion),
});

// Codex's three approval RPC param shapes — minimal subset we need.
// Wire format is camelCase (Rust serde `rename_all = "camelCase"`).
//
// GOTCHA: use `.nullish()` (not `.optional()`) because Codex's Rust
// structs are inconsistent about `skip_serializing_if = "Option::is_none"`.
// `FileChangeRequestApprovalParams.reason` has no such attribute, so
// `None` serializes as `"reason": null` — and plain `.optional()`
// rejects nulls. A null breaks parse → we reply `-32602 error` →
// app-server returns `ReviewDecision::Denied` to the apply_patch
// runtime → agent sees "patch was rejected" with no UI ever shown.
const CodexCommandApprovalParams = z.object({
  threadId: z.string().nullish(),
  turnId: z.string().nullish(),
  itemId: z.string().nullish(),
  approvalId: z.string().nullish(),
  reason: z.string().nullish(),
  command: z.string().nullish(),
  cwd: z.string().nullish(),
  commandActions: z.unknown().nullish(),
});

const CodexFileChangeApprovalParams = z.object({
  threadId: z.string().nullish(),
  turnId: z.string().nullish(),
  itemId: z.string().nullish(),
  reason: z.string().nullish(),
  grantRoot: z.string().nullish(),
});

const CodexPermissionsApprovalParams = z.object({
  threadId: z.string().nullish(),
  turnId: z.string().nullish(),
  itemId: z.string().nullish(),
  reason: z.string().nullish(),
  permissions: z.unknown().nullish(),
});

type RpcPending = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

/**
 * Bookkeeping for a paused `item/tool/requestUserInput` RPC. The
 * renderer sees questions keyed by text (matching Claude's
 * AskUserQuestion), but Codex answers must be keyed by the question's
 * original `id`. We stash both the JSON-RPC request id (so we can
 * reply to the right call) and the text→id map so we can translate
 * answers back on resolution.
 */
type PendingUserInputRequest = {
  jsonRpcId: string | number;
  textToCodexId: Map<string, string>;
  multiSelectByText: Map<string, boolean>;
};

/**
 * Paused approval RPC (command / file change / permissions). We
 * reply on the original JSON-RPC call with a `decision` payload
 * whose shape depends on which flavor of approval was requested,
 * so track `kind` alongside the id.
 *
 * For `permissions`, we also keep the originally-requested profile
 * so an "approve" can echo it back as the granted set; "reject" is
 * an empty profile.
 */
type PendingToolApprovalKind = "command" | "fileChange" | "permissions";
type PendingToolApproval = {
  jsonRpcId: string | number;
  kind: PendingToolApprovalKind;
  requestedPermissions?: unknown;
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
  // Effective UI-level permission mode. Applied on every `turn/start`
  // (Codex has no mid-turn mutation); switching modes mid-turn takes
  // effect on the next user message.
  private userMode: UserMode;

  private readonly child: ChildProcessWithoutNullStreams;
  private stdoutBuf = "";
  // Ring-buffered tail of app-server stderr. Most frames land on stdout
  // as JSON-RPC, but fatal process-level errors (bad CLI flags, rare
  // internal panics) print a human-readable line to stderr before exit.
  // Keeping the last ~4KB lets `failSession` include context instead of
  // just "exited (code 1)" when the session dies unexpectedly.
  private stderrTail = "";
  private static readonly STDERR_TAIL_LIMIT = 4096;
  private rpcId = 1;
  private readonly pendingRpc = new Map<number, RpcPending>();

  private initPromise: Promise<void>;
  private initResolve!: () => void;
  private initReject!: (error: Error) => void;

  private threadId: string | null;
  private initEmitted = false;
  private currentTurn: TurnWaiter | null = null;

  // Most recent `onEvent` callback, captured on send(). Lets mode
  // reconciliation emit `mode_changed` even when it fires outside the
  // active turn window (e.g. a late turn_context arriving after we've
  // already cleared currentTurn). Mirrors the Claude pattern.
  private lastOnEvent: ((e: SessionEvent) => void) | null = null;

  // Paused `item/tool/requestUserInput` RPC calls from app-server,
  // keyed by the requestId we emitted to the renderer. `resolveRequest`
  // looks these up to translate the user's answers back into Codex's
  // shape and reply on the originating JSON-RPC call.
  private pendingUserInputs = new Map<string, PendingUserInputRequest>();

  // Paused approval RPCs from app-server (command execution, file
  // change, permissions escalation), keyed by the requestId we
  // emitted to the renderer. `resolveRequest` looks these up to
  // build the correct response payload and reply on the paused call.
  private pendingToolApprovals = new Map<string, PendingToolApproval>();

  // Cache of file_change item payloads keyed by item_id. The
  // FileChangeRequestApproval RPC only carries `itemId` + `reason`
  // (not the diff) — the actual changes ship as an `item.started`
  // file_change notification immediately before. We stash that
  // payload here so `handleFileChangeApproval` can enrich the
  // approval card with file paths and diff previews.
  private fileChangesByItemId = new Map<string, unknown>();

  // Outstanding `<proposed_plan>` approvals — client-side only.
  // Codex doesn't pause anything waiting for plan approval; we
  // synthesize the approve/revise dialog on top of the plan item so
  // the UX matches the native Codex app (see plan.md line 124:
  // "Do not ask 'should I proceed?' in the final output. The user can
  // easily switch out of Plan mode and request implementation if you
  // have included a `<proposed_plan>` block in your response.").
  // Just a presence-check set so resolveRequest can validate the id.
  private pendingPlanApprovals = new Set<string>();

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
    this.userMode = opts?.userMode ?? "acceptEdits";
    this.threadId = opts?.resumeThreadId ?? null;

    this.initPromise = new Promise<void>((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
    });

    this.child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk: Buffer) => {
      // app-server occasionally writes progress text to stderr. Don't
      // treat any single line as fatal (would spuriously surface
      // warnings as turn errors), but retain the tail so an unexpected
      // exit can include the last bit of context.
      this.stderrTail = (this.stderrTail + chunk.toString("utf-8")).slice(-CodexSession.STDERR_TAIL_LIMIT);
    });
    this.child.on("error", (err) => this.failSession(new Error(`codex app-server spawn failed: ${err.message}`)));
    this.child.on("exit", (code, signal) => {
      const detail = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      // Pull the last non-empty line from stderr to tack onto the exit
      // error — usually the most useful bit (the actual panic / billing
      // complaint), not the startup chatter earlier in the buffer.
      const lastLine = this.stderrTail
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .pop();
      const suffix = lastLine ? `: ${lastLine}` : "";
      this.failSession(new Error(`codex app-server exited (${detail})${suffix}`));
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

      // Order matters: a server-initiated REQUEST has both `id` and
      // `method`, which would also match JsonRpcResponse (where
      // result/error are optional). Check for the request shape first
      // so we don't silently drop server-initiated calls — that was
      // the bug hanging `request_user_input` turns.
      const asServerRequest = JsonRpcServerRequest.safeParse(parsedUnknown);
      if (asServerRequest.success) {
        this.handleServerRequest(asServerRequest.data);
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
    const numericId = typeof msg.id === "number" ? msg.id : Number(msg.id);
    const pending = this.pendingRpc.get(numericId);
    if (!pending) return;
    this.pendingRpc.delete(numericId);
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

  /**
   * Dispatch a server-initiated JSON-RPC request. Today the only one
   * we handle is `item/tool/requestUserInput` — Codex's Plan-mode
   * questionnaire. Unknown methods get a `-32601` error so app-server
   * doesn't hang waiting for a reply.
   */
  private handleServerRequest(req: z.infer<typeof JsonRpcServerRequest>): void {
    const method = this.normalizeMethod(req.method);
    // Temporary diagnostic — remove once approval plumbing is verified.
    // console.log(`[codex] server request: ${req.method} (id=${req.id})`);

    if (method === "item.tool.requestUserInput") {
      this.handleRequestUserInput(req);
      return;
    }

    if (method === "item.commandExecution.requestApproval") {
      this.handleCommandApproval(req);
      return;
    }

    if (method === "item.fileChange.requestApproval") {
      this.handleFileChangeApproval(req);
      return;
    }

    if (method === "item.permissions.requestApproval") {
      this.handlePermissionsApproval(req);
      return;
    }

    void this.writeJsonLine({
      jsonrpc: "2.0",
      id: req.id,
      error: {
        code: -32601,
        message: `Unsupported server request: ${req.method}`,
      },
    });
  }

  /**
   * Emit a `tool_approval` PendingRequest and record the JSON-RPC id
   * + approval kind for the resolver. Shared helper for all three
   * approval flavors — only the request shape differs.
   */
  private emitToolApproval(
    req: z.infer<typeof JsonRpcServerRequest>,
    kind: PendingToolApprovalKind,
    toolName: string,
    toolInput: Record<string, unknown>,
    requestedPermissions?: unknown,
  ): void {
    const requestId = randomUUID();
    this.pendingToolApprovals.set(requestId, {
      jsonRpcId: req.id,
      kind,
      ...(requestedPermissions !== undefined && { requestedPermissions }),
    });
    const request: PendingRequest = {
      kind: "tool_approval",
      requestId,
      toolName,
      toolInput,
    };
    const emit = this.currentTurn?.onEvent ?? this.lastOnEvent;
    if (!emit) {
      // console.log(`[codex] emitToolApproval: NO EMITTER — dropping ${kind} approval (jsonRpcId=${req.id})`);
    } else {
      // console.log(`[codex] emitToolApproval: ${kind} requestId=${requestId} toolName=${toolName}`);
    }
    emit?.({ kind: "pending_request", request });
  }

  private handleCommandApproval(req: z.infer<typeof JsonRpcServerRequest>): void {
    const parsed = CodexCommandApprovalParams.safeParse(req.params);
    if (!parsed.success) {
      void this.writeJsonLine({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32602, message: `Invalid command approval params: ${parsed.error.message}` },
      });
      return;
    }
    // Surface as a Bash-shaped tool call so the existing
    // ToolApprovalCard renders the command preview correctly.
    const displayCommand = typeof parsed.data.command === "string"
      ? codexDisplayCommand(parsed.data.command)
      : undefined;
    const toolInput: Record<string, unknown> = {
      command: parsed.data.command ?? "",
      ...(displayCommand ? { display_command: displayCommand } : {}),
      ...(parsed.data.reason && { description: parsed.data.reason }),
      ...(parsed.data.cwd && { cwd: parsed.data.cwd }),
      ...(parsed.data.commandActions !== undefined ? { command_actions: parsed.data.commandActions } : {}),
    };
    this.emitToolApproval(req, "command", "Bash", toolInput);
  }

  private handleFileChangeApproval(req: z.infer<typeof JsonRpcServerRequest>): void {
    const parsed = CodexFileChangeApprovalParams.safeParse(req.params);
    if (!parsed.success) {
      void this.writeJsonLine({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32602, message: `Invalid fileChange approval params: ${parsed.error.message}` },
      });
      return;
    }

    // In `acceptEdits` we auto-approve file-change RPCs on the
    // client. We run with `approvalPolicy: "untrusted"` (same as
    // `ask`) specifically so the server escalates every apply_patch
    // and every command — giving our gate a chance to be selective.
    // For acceptEdits the selection is "edits yes, commands via
    // card"; here we handle the edit half.
    if (this.userMode === "acceptEdits") {
      // console.log(`[codex] fileChange approval auto-accept (acceptEdits mode) id=${parsed.data.itemId ?? "(none)"}`);
      void this.writeJsonLine({
        jsonrpc: "2.0",
        id: req.id,
        result: { decision: "accept" },
      });
      return;
    }

    // FileChangeRequestApproval doesn't carry the diff itself — the
    // file_change item was emitted as its own `item.*` event before
    // this RPC arrived, and we cached its payload in
    // `fileChangesByItemId`. Look it up so the approval card can
    // show the actual path + diff instead of just an opaque itemId.
    const itemId = parsed.data.itemId ?? undefined;
    const cachedChanges = itemId ? this.fileChangesByItemId.get(itemId) : undefined;
    // console.log(`[codex] fileChange approval lookup: itemId=${itemId ?? "(none)"} cachedFound=${cachedChanges !== undefined}`);
    const toolInput: Record<string, unknown> = {
      ...(parsed.data.reason && { reason: parsed.data.reason }),
      ...(parsed.data.grantRoot && { grantRoot: parsed.data.grantRoot }),
      ...(itemId && { itemId }),
      ...(cachedChanges !== undefined && { changes: cachedChanges }),
    };
    this.emitToolApproval(req, "fileChange", "apply_patch", toolInput);
  }

  private handlePermissionsApproval(req: z.infer<typeof JsonRpcServerRequest>): void {
    const parsed = CodexPermissionsApprovalParams.safeParse(req.params);
    if (!parsed.success) {
      void this.writeJsonLine({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32602, message: `Invalid permissions approval params: ${parsed.error.message}` },
      });
      return;
    }
    const toolInput: Record<string, unknown> = {
      ...(parsed.data.reason && { reason: parsed.data.reason }),
      ...(parsed.data.permissions !== undefined && { permissions: parsed.data.permissions }),
    };
    this.emitToolApproval(req, "permissions", "RequestPermissions", toolInput, parsed.data.permissions);
  }

  /**
   * Translate Codex's `item/tool/requestUserInput` into our
   * `ask_user_question` PendingRequest and stash the JSON-RPC id so
   * `resolveRequest` can reply on the paused call.
   *
   * Codex questions carry an `id` we must echo back in the answer
   * record; our renderer keys answers by question TEXT (matching
   * Claude's AskUserQuestion). We store a text→id map so translation
   * on the way out is straightforward.
   */
  private handleRequestUserInput(req: z.infer<typeof JsonRpcServerRequest>): void {
    const parsed = CodexUserInputRequestParams.safeParse(req.params);
    if (!parsed.success) {
      void this.writeJsonLine({
        jsonrpc: "2.0",
        id: req.id,
        error: {
          code: -32602,
          message: `Invalid requestUserInput params: ${parsed.error.message}`,
        },
      });
      return;
    }

    const requestId = randomUUID();
    const textToCodexId = new Map<string, string>();
    const multiSelectByText = new Map<string, boolean>();

    // Map Codex's question shape onto our AskUserQuestionItem. Header
    // is optional in Codex, required by the renderer — fall back to a
    // truncated prefix of the question text so the card always has a
    // title.
    const mappedQuestions = parsed.data.questions.map((q) => {
      const header = q.header && q.header.trim().length > 0
        ? q.header
        : q.question.slice(0, 60);
      textToCodexId.set(q.question, q.id);
      multiSelectByText.set(q.question, q.multiSelect === true);
      return {
        question: q.question,
        header,
        options: q.options.map((opt) => ({
          label: opt.label,
          description: opt.description ?? "",
        })),
        multiSelect: q.multiSelect === true,
      };
    });

    this.pendingUserInputs.set(requestId, {
      jsonRpcId: req.id,
      textToCodexId,
      multiSelectByText,
    });

    const request: PendingRequest = {
      kind: "ask_user_question",
      requestId,
      toolName: "request_user_input",
      input: { questions: mappedQuestions },
    };

    const emit = this.currentTurn?.onEvent ?? this.lastOnEvent;
    emit?.({ kind: "pending_request", request });
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

  /**
   * Walk common error-payload shapes and return the first usable human
   * message. Separate from {@link pickTextDelta} because error payloads
   * don't use `text`/`delta` — app-server / the OpenAI SDK wrap errors
   * as `{ message }`, `{ error: { message } }`, or (rarely) a bare
   * string. Without this, out-of-credits / quota errors fall through to
   * the generic "Codex stream error" fallback and the user has no way
   * to know what actually went wrong.
   */
  private pickErrorMessage(payload: unknown): string | null {
    if (!payload) return null;
    if (typeof payload === "string" && payload.length > 0) return payload;
    if (typeof payload !== "object") return null;
    const p = payload as Record<string, unknown>;
    const err = p.error as Record<string, unknown> | string | undefined;
    const data = p.data as Record<string, unknown> | undefined;
    const dataErr = data?.error as Record<string, unknown> | string | undefined;
    const params = p.params as Record<string, unknown> | undefined;
    const paramsErr = params?.error as Record<string, unknown> | string | undefined;
    const candidates: unknown[] = [
      p.message,
      typeof err === "string" ? err : err?.message,
      typeof dataErr === "string" ? dataErr : dataErr?.message,
      params?.message,
      typeof paramsErr === "string" ? paramsErr : paramsErr?.message,
      p.reason,
      p.detail,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim().length > 0) return c;
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

  /**
   * Pull a turn_context payload out of the many shapes app-server might
   * use. Handles: top-level `{ payload }`, JSON-RPC `{ params: { payload } }`,
   * bare params (payload fields spread directly), and item-wrapped
   * `{ item: { type: "turn_context", ... } }`. Returns null if nothing
   * turn_context-shaped is in there.
   */
  private pickTurnContextPayload(
    typeHint: string | null,
    params: unknown,
  ): Record<string, unknown> | null {
    if (!params || typeof params !== "object") return null;
    const p = params as Record<string, unknown>;

    if (typeHint === "turn_context") {
      const payload = (p.payload ?? p) as Record<string, unknown>;
      if (payload && typeof payload === "object") return payload;
    }

    const nestedParams = p.params as Record<string, unknown> | undefined;
    if (nestedParams && typeof nestedParams === "object") {
      const payload = (nestedParams.payload ?? nestedParams) as Record<string, unknown>;
      if (payload && typeof payload === "object" && ("approval_policy" in payload || "sandbox_policy" in payload || "collaboration_mode" in payload)) {
        return payload;
      }
    }

    if ("approval_policy" in p || "sandbox_policy" in p || "collaboration_mode" in p) {
      return p;
    }
    const topPayload = p.payload as Record<string, unknown> | undefined;
    if (topPayload && typeof topPayload === "object" && ("approval_policy" in topPayload || "sandbox_policy" in topPayload || "collaboration_mode" in topPayload)) {
      return topPayload;
    }

    return null;
  }

  /**
   * Reconcile our cached {@link userMode} against a server-reported
   * turn_context. Ground truth overrides the cache; drift triggers a
   * `mode_changed` event so the renderer dropdown converges. Mirrors
   * Claude's PreToolUse hook pattern — we want the UI to match what
   * the agent *actually* ran under, not what we optimistically set.
   */
  private reconcileModeFromTurnContext(payload: Record<string, unknown>): void {
    const approvalPolicy = typeof payload.approval_policy === "string" ? payload.approval_policy : undefined;
    const sandboxPolicy = payload.sandbox_policy as { type?: unknown } | undefined;
    const sandboxType = sandboxPolicy && typeof sandboxPolicy.type === "string" ? sandboxPolicy.type : undefined;
    const collaborationMode = payload.collaboration_mode as { mode?: unknown } | undefined;
    const modeRaw = collaborationMode && typeof collaborationMode.mode === "string" ? collaborationMode.mode : undefined;

    const observed = codexTurnContextToUserMode(approvalPolicy, sandboxType, modeRaw);
    if (observed === this.userMode) return;
    this.userMode = observed;
    const emit = this.currentTurn?.onEvent ?? this.lastOnEvent;
    emit?.({ kind: "mode_changed", mode: observed });
  }

  private handleNotification(methodRaw: string, params: unknown): void {
    const method = this.normalizeMethod(methodRaw);

    // turn_context: the app-server's ground truth about the policies
    // the current turn is running under. Matches several plausible
    // wire names since the protocol isn't formally documented.
    if (method === "turn_context" || method === "turn.context" || method === "turnContext") {
      const payload = this.pickTurnContextPayload("turn_context", params);
      if (payload) this.reconcileModeFromTurnContext(payload);
      return;
    }

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

      // Codex's wire format for `item.type` is camelCase (per TS
      // schema export at codex-rs/app-server-protocol/schema/
      // typescript/v2/ThreadItem.ts). Accept snake_case too because
      // earlier versions of the protocol may have used it and we
      // want to be resilient to either.
      const t = itemType ?? "";
      const isType = (...names: string[]) => names.includes(t);

      // turn_context can also arrive wrapped as an item. Handled here —
      // before the `currentTurn` gate below — so mode reconciliation
      // works even on the item.started that immediately follows
      // turn/start, when other item handlers require currentTurn.
      if (isType("turnContext", "turn_context")) {
        const payload = this.pickTurnContextPayload("turn_context", item);
        if (payload) this.reconcileModeFromTurnContext(payload);
        return;
      }

      if (!itemType || !this.currentTurn) return;

      if (isType("agentMessage", "agent_message") && method === "item.completed") {
        // Don't re-emit the full text here — the streaming deltas
        // (`item/agentMessage/delta`) have already built the message
        // in the renderer. Emitting again would duplicate the whole
        // message in the chat. We only land here to acknowledge the
        // completion; the item itself is a no-op for UI purposes.
        return;
      }

      if (isType("commandExecution", "command_execution")) {
        const command = typeof item.command === "string" ? item.command : "";
        const displayCommand = command ? codexDisplayCommand(command) : undefined;
        this.currentTurn.onEvent({
          kind: "tool_use",
          toolUseId: typeof item.id === "string" ? item.id : undefined,
          toolName: "shell",
          toolInput: {
            command,
            ...(displayCommand ? { display_command: displayCommand } : {}),
            ...(item.commandActions !== undefined ? { command_actions: item.commandActions } : {}),
            // Codex serializes these as camelCase on the wire.
            output: item.aggregatedOutput ?? item.aggregated_output,
            exit_code: item.exitCode ?? item.exit_code,
          } as Record<string, unknown>,
        });
        return;
      }

      if (isType("fileChange", "file_change")) {
        // Cache every file_change item keyed by id so a follow-up
        // FileChangeRequestApproval RPC (which only carries itemId)
        // can render the diff. Fires on both started + completed;
        // always prefer the latest payload.
        if (typeof item.id === "string" && item.changes !== undefined && item.changes !== null) {
          this.fileChangesByItemId.set(item.id, item.changes);
          // console.log(`[codex] cached file_change changes id=${item.id} method=${method} len=${Array.isArray(item.changes) ? item.changes.length : "?"}`);
        }
        if (method === "item.completed") {
          this.currentTurn.onEvent({
            kind: "tool_use",
            toolUseId: typeof item.id === "string" ? item.id : undefined,
            toolName: "apply_patch",
            toolInput: {
              changes: item.changes,
              status: item.status,
            } as Record<string, unknown>,
          });
        }
        return;
      }

      if (isType("mcpToolCall", "mcp_tool_call")) {
        this.currentTurn.onEvent({
          kind: "tool_use",
          toolUseId: typeof item.id === "string" ? item.id : undefined,
          toolName: `${String(item.server ?? "mcp")}.${String(item.tool ?? "tool")}`,
          toolInput: ((item.arguments as Record<string, unknown>) ?? {}) as Record<string, unknown>,
        });
        return;
      }

      if (isType("webSearch", "web_search")) {
        this.currentTurn.onEvent({
          kind: "tool_use",
          toolUseId: typeof item.id === "string" ? item.id : undefined,
          toolName: "web_search",
          toolInput: { query: item.query } as Record<string, unknown>,
        });
        return;
      }

      // `<proposed_plan>` block Codex extracted from the assistant
      // message. Text is the plan body, without the surrounding tags.
      // Wait for `item.completed` — earlier `started`/`updated` events
      // stream partial text (see `item/plan/delta`) and we don't want
      // to flash a half-written plan as an approval card.
      //
      // Gate the approve/reject dialog on plan mode. The `<proposed_plan>`
      // tag is a generic rendering hint in Codex — the parser runs
      // regardless of mode, and the model sometimes emits the block
      // outside plan mode too. Codex's own TUI only opens its
      // implementation popup when `active_mode_kind == Plan` (see
      // chatwidget.rs:2445); outside plan mode it just renders the
      // plan into history. We mirror that: in plan mode → approval
      // dialog; otherwise → direct transcript card.
      if (isType("plan") && method === "item.completed") {
        const text = typeof item.text === "string" ? item.text : "";
        if (text.length === 0) return;
        if (this.userMode !== "plan") {
          this.currentTurn.onEvent({ kind: "plan_card", plan: text });
          return;
        }
        const requestId = randomUUID();
        this.pendingPlanApprovals.add(requestId);
        const request: PendingRequest = {
          kind: "exit_plan_approval",
          requestId,
          toolName: "proposed_plan",
          plan: text,
        };
        this.currentTurn.onEvent({ kind: "pending_request", request });
        return;
      }

      if (isType("todoList", "todo_list")) {
        this.currentTurn.onEvent({
          kind: "tool_use",
          toolUseId: typeof item.id === "string" ? item.id : undefined,
          toolName: "update_plan",
          toolInput: { items: item.items } as Record<string, unknown>,
        });
        return;
      }

      if (isType("error") && method === "item.completed") {
        const msg = this.pickErrorMessage(item) ?? "Unknown Codex error";
        this.currentTurn.onEvent({ kind: "error", message: msg });
      }
      return;
    }

    if (method === "turn.started") return;

    if (method === "turn.completed") {
      // console.log(`[codex] turn.completed`);
      if (!this.currentTurn) return;
      const turn = this.currentTurn;
      this.currentTurn = null;
      turn.resolve();
      return;
    }

    if (method === "turn.failed") {
      // console.log(`[codex] turn.failed`);
      const msg = this.pickErrorMessage(params) ?? "Turn failed";
      if (this.currentTurn) {
        const turn = this.currentTurn;
        this.currentTurn = null;
        turn.reject(new Error(msg));
      }
      return;
    }

    if (method === "error" && this.currentTurn) {
      // Prefer the error-shape extractor (message / error.message /
      // nested variants); only fall back to text/delta for the rare
      // case where app-server frames an error as a streamed delta.
      const msg =
        this.pickErrorMessage(params) ??
        this.pickTextDelta(params) ??
        "Codex stream error";
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

    const startOpts = codexModeOptions(this.userMode, this.cwd, this.modelLabel, this.effort);
    const result = await this.rpc("thread/start", {
      ...(this.modelLabel && { model: this.modelLabel }),
      ...(this.cwd && { cwd: this.cwd }),
      approvalPolicy: startOpts.approvalPolicy,
      sandbox: startOpts.sandbox,
      collaborationMode: {
        mode: startOpts.collaborationMode,
        settings: startOpts.collaborationSettings,
      },
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
    this.lastOnEvent = onEvent;
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
        const turnOpts = codexModeOptions(this.userMode, this.cwd, this.modelLabel, this.effort);
        // console.log(`[codex] turn/start userMode=${this.userMode} approvalPolicy=${turnOpts.approvalPolicy} sandbox=${turnOpts.sandbox} collabMode=${turnOpts.collaborationMode}`);
        void this.rpc("turn/start", {
          threadId: this.threadId,
          input,
          ...(this.cwd && { cwd: this.cwd }),
          ...(this.modelLabel && { model: this.modelLabel }),
          ...(this.effort && { effort: this.effort }),
          approvalPolicy: turnOpts.approvalPolicy,
          sandboxPolicy: turnOpts.sandboxPolicy,
          sandbox: turnOpts.sandbox,
          collaborationMode: {
            mode: turnOpts.collaborationMode,
            settings: turnOpts.collaborationSettings,
          },
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
    });
    if (turnError) onEvent({ kind: "error", message: turnError });
    onEvent({ kind: "done" });
  }

  async resolveRequest(resolution: RequestResolution): Promise<void> {
    switch (resolution.kind) {
      case "ask_user_question": {
        const pending = this.pendingUserInputs.get(resolution.requestId);
        if (!pending) return;
        this.pendingUserInputs.delete(resolution.requestId);

        // Translate `{ questionText: "answer" | "a, b" }` back into
        // Codex's `{ [codexQuestionId]: { answers: string[] } }`.
        // Multi-select answers come in as ", "-joined strings (see
        // QuestionCard submission logic); split back to an array.
        const codexAnswers: Record<string, { answers: string[] }> = {};
        for (const [questionText, answerValue] of Object.entries(resolution.answers)) {
          const codexId = pending.textToCodexId.get(questionText);
          if (!codexId) continue;
          const isMulti = pending.multiSelectByText.get(questionText) === true;
          const arr = isMulti
            ? answerValue.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
            : [answerValue];
          codexAnswers[codexId] = { answers: arr };
        }

        await this.writeJsonLine({
          jsonrpc: "2.0",
          id: pending.jsonRpcId,
          result: { answers: codexAnswers },
        });
        return;
      }
      case "ask_user_question_cancel": {
        const pending = this.pendingUserInputs.get(resolution.requestId);
        if (!pending) return;
        this.pendingUserInputs.delete(resolution.requestId);
        // Reply with a JSON-RPC error so app-server unwinds the paused
        // tool call cleanly instead of hanging. Code -32000 is the
        // reserved range for implementation-defined server errors.
        await this.writeJsonLine({
          jsonrpc: "2.0",
          id: pending.jsonRpcId,
          error: {
            code: -32000,
            message: "User dismissed the question.",
          },
        });
        return;
      }
      case "exit_plan_approval": {
        // Client-side flow: Codex doesn't pause for plan approval
        // (no tool call is waiting). The turn that produced the
        // `<proposed_plan>` may still be running — Plan mode emits
        // the plan mid-turn and keeps streaming. Interrupt it so
        // our follow-up turn isn't queued behind an open-ended one.
        //
        // In every case (approve, reject-with-feedback, reject-
        // without-feedback) we queue a follow-up turn so the agent
        // acknowledges the decision — matches Claude's behavior
        // where the denial text becomes tool-result context and the
        // model responds.
        if (!this.pendingPlanApprovals.delete(resolution.requestId)) return;
        const emit = this.lastOnEvent;
        if (!emit) return;

        await this.interrupt();

        if (resolution.approved) {
          // Switch out of plan mode so the next turn runs with
          // edit permissions, then ask the agent to proceed.
          // acceptEdits is the natural "go implement" mode.
          await this.setMode("acceptEdits", emit);
          this.send(
            "Please proceed with implementing the plan.",
            undefined,
            emit,
          );
        } else {
          // Stay in plan mode. Forward the user's feedback if any,
          // otherwise a bare rejection message. Either way the
          // agent sees a user turn and can respond, so the UI
          // lifecycle (status → running → idle) stays clean.
          const feedback = resolution.message?.trim();
          const message = feedback && feedback.length > 0
            ? feedback
            : "I rejected the proposed plan. Please revise it or ask clarifying questions before trying again.";
          this.send(message, undefined, emit);
        }
        return;
      }
      case "tool_approval": {
        const pending = this.pendingToolApprovals.get(resolution.requestId);
        if (!pending) {
          // console.log(`[codex] tool_approval resolve: no pending entry for ${resolution.requestId}`);
          return;
        }
        this.pendingToolApprovals.delete(resolution.requestId);
        // console.log(`[codex] tool_approval resolve: kind=${pending.kind} approved=${resolution.approved} jsonRpcId=${pending.jsonRpcId}`);

        // Each approval flavor has a different response shape. Command
        // + file-change use a `decision` enum; permissions echo a
        // `GrantedPermissionProfile` (empty object = granted nothing).
        let result: Record<string, unknown>;
        if (pending.kind === "permissions") {
          result = resolution.approved
            ? {
                permissions: pending.requestedPermissions ?? {},
                scope: "turn",
              }
            : { permissions: {}, scope: "turn" };
        } else {
          // command | fileChange — same `{ decision }` shape.
          result = { decision: resolution.approved ? "accept" : "decline" };
        }

        await this.writeJsonLine({
          jsonrpc: "2.0",
          id: pending.jsonRpcId,
          result,
        });
        return;
      }
    }
  }

  /**
   * Update the effective UserMode. Codex has no mid-turn mutation for
   * approval/sandbox policies — they're turn-scoped on `turn/start` —
   * so we just stash the new mode. It will be picked up on the next
   * user message. Mid-turn callers see the in-flight turn finish
   * under the previous policies.
   */
  async setMode(mode: UserMode, onEvent: (e: SessionEvent) => void): Promise<void> {
    if (this.userMode === mode) return;
    this.userMode = mode;
    onEvent({ kind: "mode_changed", mode });
  }

  get currentUserMode(): UserMode {
    return this.userMode;
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
    // Fail any paused requestUserInput calls so app-server unwinds the
    // tool rather than holding the RPC forever. We can't `await`
    // writeJsonLine here since close() is sync; fire-and-forget is
    // fine — the child is being killed either way.
    for (const [, pending] of this.pendingUserInputs) {
      void this.writeJsonLine({
        jsonrpc: "2.0",
        id: pending.jsonRpcId,
        error: { code: -32000, message: "Session closed." },
      }).catch(() => { /* process likely already dead */ });
    }
    this.pendingUserInputs.clear();
    // Decline any paused approval RPCs so app-server unwinds the
    // tool call rather than holding the connection open.
    for (const [, pending] of this.pendingToolApprovals) {
      const result = pending.kind === "permissions"
        ? { permissions: {}, scope: "turn" }
        : { decision: "decline" };
      void this.writeJsonLine({
        jsonrpc: "2.0",
        id: pending.jsonRpcId,
        result,
      }).catch(() => { /* process likely already dead */ });
    }
    this.pendingToolApprovals.clear();
    this.pendingPlanApprovals.clear();
    try {
      this.child.kill();
    } catch {
      // ignore
    }
  }
}
