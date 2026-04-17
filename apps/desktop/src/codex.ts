import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { Codex, type Thread, type ThreadEvent, type Input } from "@openai/codex-sdk";
import type {
  AgentSession,
  ContextUsage,
  ImageInput,
  SessionEvent,
} from "./agent-session";

export function isCodexInstalled(): boolean {
  try {
    execSync("which codex", { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Codex reasoning-effort levels, in the exact order the CLI/SDK accepts.
 *
 * GOTCHA: the Codex SDK uses a DIFFERENT set of effort levels than
 * Claude. Codex: minimal/low/medium/high/xhigh (5 levels).
 * Claude: max/high/medium/low (4 levels). The renderer stores them
 * per-provider and picks the right list based on `thread.provider`.
 */
export type CodexEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export type CodexSessionOptions = {
  resumeThreadId?: string;
  cwd?: string;
  model?: string;
  effort?: CodexEffort;
};

/**
 * One multi-turn conversation with an OpenAI Codex agent via
 * `@openai/codex-sdk`.
 *
 * Implements {@link AgentSession} so it lives in the same
 * `Map<threadId, AgentSession>` as {@link ClaudeSession}.
 *
 * ── Key differences from ClaudeSession ───────────────────────────
 *
 *  - **No pause-for-input protocol.** Codex has no analogue of
 *    Claude's AskUserQuestion. `respondToTool` is a no-op and we
 *    always emit `result.deferredToolUse = null`.
 *
 *  - **No dollar cost reporting.** `turn.completed.usage` exposes
 *    token counts but not a dollar amount (billing runs against the
 *    user's ChatGPT plan). We emit `costUsd = null`.
 *
 *  - **No `max_tokens` surfaced.** The SDK only gives us
 *    `input_tokens + output_tokens`; there's no model-side context
 *    limit in the event payload, so `contextUsage` is `null` unless
 *    we compute it another way. We choose the safe path: null.
 *
 *  - **Images go in as filesystem paths, not base64.** The SDK's
 *    `UserInput.local_image` takes `{ path }`. We write incoming
 *    base64 attachments to a temp file first. We clean those up on
 *    session close.
 *
 *  - **Turn cancellation uses `AbortController`.** Unlike Claude's
 *    `query.interrupt()` the Codex SDK surfaces an `AbortSignal` via
 *    `TurnOptions.signal`. We own one controller per in-flight turn.
 *
 *  - **Sequential turn queue.** The SDK's `runStreamed()` returns a
 *    single `AsyncGenerator`; we can't push a follow-up while a turn
 *    is still streaming. So `send()` enqueues messages and a driver
 *    loop drains them one at a time, matching ClaudeSession's
 *    "fire-and-forget" contract from the caller's point of view.
 */
export class CodexSession implements AgentSession {
  readonly provider = "codex" as const;

  private codex: Codex;
  private thread: Thread;
  private cwd: string | undefined;

  // Queue of pending user messages + their onEvent callbacks. Each entry
  // represents one turn. We process them sequentially in `driveQueue`.
  private queue: Array<{ input: Input; onEvent: (e: SessionEvent) => void }> = [];
  private draining = false;

  // Live controller for the currently-streaming turn, so `interrupt()`
  // can abort mid-turn.
  private currentAbort: AbortController | null = null;

  // Temp files we wrote for image attachments; removed on close().
  private tempImagePaths: string[] = [];

  // Has the renderer seen an `init` event yet for this session? We emit
  // exactly one after the first `thread.started` or on resume.
  private initEmitted = false;

  // The session id we expose via the `init` event. Populated after the
  // first `thread.started` event, or from a resume id.
  private threadId: string | null = null;

  constructor(opts?: CodexSessionOptions) {
    this.cwd = opts?.cwd;

    // GOTCHA: we must pass workingDirectory here (not later per-turn).
    // The SDK scopes sandbox permissions to this directory for the
    // lifetime of the thread.
    //
    // GOTCHA: `skipGitRepoCheck: true` because we allow users to open
    // folders that aren't git repos. The default errors out otherwise.
    const threadOptions = {
      workingDirectory: this.cwd,
      skipGitRepoCheck: true,
      ...(opts?.model && { model: opts.model }),
      ...(opts?.effort && { modelReasoningEffort: opts.effort }),
      // "workspace-write" matches Claude's `bypassPermissions` mode —
      // the agent can edit files in its cwd but not the whole FS.
      sandboxMode: "workspace-write" as const,
      // "never" — don't block on approvals; we've already told the user
      // this session will write to their workspace.
      approvalPolicy: "never" as const,
    };

    this.codex = new Codex();
    this.thread = opts?.resumeThreadId
      ? this.codex.resumeThread(opts.resumeThreadId, threadOptions)
      : this.codex.startThread(threadOptions);

    if (opts?.resumeThreadId) {
      this.threadId = opts.resumeThreadId;
    }
  }

  /**
   * Convert our IPC-level {@link ImageInput} (base64 + mediaType) into
   * the Codex SDK's `local_image` shape, which takes a filesystem path.
   *
   * We write each image to `~/<tmp>/openclawdex-codex-<uuid>.<ext>` so
   * the SDK can pass it to the CLI via stdin-free filesystem I/O.
   */
  private imagesToUserInput(text: string, images: ImageInput[]): Input {
    const items: Input = [];
    for (const img of images) {
      const ext = img.mediaType.split("/")[1] ?? "png";
      const p = path.join(os.tmpdir(), `openclawdex-codex-${randomUUID()}.${ext}`);
      fs.writeFileSync(p, Buffer.from(img.base64, "base64"));
      this.tempImagePaths.push(p);
      items.push({ type: "local_image", path: p });
    }
    if (text) items.push({ type: "text", text });
    return items;
  }

  send(
    message: string,
    images: ImageInput[] | undefined,
    onEvent: (e: SessionEvent) => void,
  ): void {
    const input: Input =
      images && images.length > 0
        ? this.imagesToUserInput(message, images)
        : message;

    this.queue.push({ input, onEvent });
    if (!this.draining) {
      this.draining = true;
      void this.driveQueue();
    }
  }

  /**
   * Process queued turns one at a time. Each turn: open a stream, fan
   * Codex events out to the caller's `onEvent`, then emit `done`.
   */
  private async driveQueue(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const { input, onEvent } = this.queue.shift()!;
        await this.runOneTurn(input, onEvent);
      }
    } finally {
      this.draining = false;
    }
  }

  private async runOneTurn(
    input: Input,
    onEvent: (e: SessionEvent) => void,
  ): Promise<void> {
    const abort = new AbortController();
    this.currentAbort = abort;

    // Track tokens across updates so we can emit a final ContextUsage
    // on `turn.completed`.
    let lastUsage: ContextUsage | null = null;
    // Captured from JSON events on stdout. Preferred over the
    // `exited with code` wrapper the SDK throws, because that wrapper
    // only carries stderr (e.g. "Reading prompt from stdin...") while
    // the real reason (rate limit, auth, etc.) is in the JSON event.
    let turnError: string | null = null;

    try {
      const { events } = await this.thread.runStreamed(input, { signal: abort.signal });

      for await (const ev of events) {
        this.handleEvent(ev, onEvent);

        if (ev.type === "turn.completed") {
          const u = ev.usage;
          const total = u.input_tokens + u.output_tokens;
          // GOTCHA: Codex's `Usage` payload carries no context-window
          // limit, so `maxTokens` and `percentage` are unknown. We
          // set maxTokens=0 + percentage=0 as sentinels; renderers
          // already null-check via ContextStats optionality.
          lastUsage = { totalTokens: total, maxTokens: 0, percentage: 0 };
        } else if (ev.type === "turn.failed") {
          turnError = ev.error.message;
        } else if (ev.type === "error") {
          turnError = ev.message;
        }
      }
    } catch (err) {
      const aborted = err instanceof Error && (err.name === "AbortError" || abort.signal.aborted);
      if (!aborted && !turnError) {
        turnError = err instanceof Error ? err.message : String(err);
      }
    } finally {
      this.currentAbort = null;
    }

    onEvent({
      kind: "result",
      costUsd: null,
      durationMs: null,
      isError: turnError !== null,
      contextUsage: lastUsage,
      deferredToolUse: null,
    });

    if (turnError) {
      onEvent({ kind: "error", message: turnError });
    }
    onEvent({ kind: "done" });
  }

  /**
   * Translate one Codex `ThreadEvent` into our provider-neutral
   * {@link SessionEvent} stream.
   *
   * GOTCHA: Codex emits many item.* lifecycle events per item
   * (started → updated* → completed). For text we only forward
   * `agent_message`'s COMPLETED event as one big `text_delta`,
   * because the SDK doesn't expose per-token deltas in a shape we
   * can stream incrementally. This means Codex responses appear
   * "chunked by message" in the UI, where Claude responses stream
   * character-by-character — that's a real UX difference worth
   * keeping in mind when debugging "why isn't my Codex reply
   * streaming?".
   */
  private handleEvent(ev: ThreadEvent, onEvent: (e: SessionEvent) => void): void {
    switch (ev.type) {
      case "thread.started": {
        this.threadId = ev.thread_id;
        if (!this.initEmitted) {
          this.initEmitted = true;
          onEvent({
            kind: "init",
            sessionId: ev.thread_id,
            // GOTCHA: the SDK doesn't echo back the model name on
            // thread.started. We fall back to a constant label; the
            // renderer's model picker already knows what was selected.
            model: "codex",
          });
        }
        break;
      }

      case "item.completed": {
        const item = ev.item;
        switch (item.type) {
          case "agent_message":
            onEvent({ kind: "text_delta", text: item.text });
            break;

          case "command_execution":
            // Surface as a tool_use so the ChatView's tool-card UI
            // renders it uniformly with Claude's Bash/Shell tool.
            onEvent({
              kind: "tool_use",
              toolName: "shell",
              toolInput: { command: item.command, output: item.aggregated_output, exit_code: item.exit_code },
            });
            break;

          case "file_change":
            onEvent({
              kind: "tool_use",
              toolName: "apply_patch",
              toolInput: { changes: item.changes, status: item.status },
            });
            break;

          case "mcp_tool_call":
            onEvent({
              kind: "tool_use",
              toolName: `${item.server}.${item.tool}`,
              toolInput: (item.arguments as Record<string, unknown>) ?? {},
            });
            break;

          case "web_search":
            onEvent({
              kind: "tool_use",
              toolName: "web_search",
              toolInput: { query: item.query },
            });
            break;

          case "todo_list":
            onEvent({
              kind: "tool_use",
              toolName: "update_plan",
              toolInput: { items: item.items },
            });
            break;

          case "reasoning":
            // Reasoning summaries aren't surfaced in the Claude flow
            // either; we skip them to keep the transcript tight.
            break;

          case "error":
            onEvent({ kind: "error", message: item.message });
            break;
        }
        break;
      }

      case "turn.started":
      case "turn.completed":
      case "turn.failed":
      case "item.started":
      case "item.updated":
      case "error":
        // Lifecycle events we handle in runOneTurn (or explicitly
        // ignore to avoid double-emitting on update+complete).
        break;
    }
  }

  /**
   * GOTCHA: Codex has no pause-for-input protocol. This method is a
   * no-op; it only exists to satisfy {@link AgentSession}.
   */
  respondToTool(_toolUseId: string, _text: string): void {
    // intentionally empty
  }

  async interrupt(): Promise<void> {
    this.currentAbort?.abort();
  }

  close(): void {
    this.currentAbort?.abort();
    this.currentAbort = null;
    this.queue = [];
    this.draining = false;

    // Best-effort cleanup of temp image files.
    for (const p of this.tempImagePaths) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
    this.tempImagePaths = [];
  }
}
