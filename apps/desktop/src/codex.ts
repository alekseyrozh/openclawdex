import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { Codex, type Thread, type ThreadEvent, type Input } from "@openai/codex-sdk";
import { type CodexReasoningEffort } from "@openclawdex/shared";
import type {
  AgentSession,
  ContextUsage,
  ImageInput,
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

  // Queue of pending user messages + their onEvent callbacks. Each
  // entry represents one turn. We process them sequentially in
  // `driveQueue`. `tempImagePaths` holds any tempfiles we wrote *for
  // this turn only* — they're removed as soon as `runOneTurn` settles,
  // so long sessions with many image turns don't leak into `tmpdir`.
  private queue: Array<{
    input: Input;
    onEvent: (e: SessionEvent) => void;
    tempImagePaths: string[];
  }> = [];
  private draining = false;

  // Live controller for the currently-streaming turn, so `interrupt()`
  // can abort mid-turn.
  private currentAbort: AbortController | null = null;
  // Tracks the last full text snapshot seen for each in-flight
  // `agent_message` item so we can emit only appended suffixes on
  // `item.updated` and `item.completed`.
  private agentMessageTextById = new Map<string, string>();

  // Has the renderer seen an `init` event yet for this session?
  //
  // ── When `init` fires ───────────────────────────────────────────
  //
  //   (a) NEW thread (no `resumeThreadId` passed): the Codex SDK emits
  //       a `thread.started` event as the very first event of the first
  //       turn, carrying the freshly-minted `thread_id`. We forward that
  //       as `{kind: "init", sessionId, model}`. main.ts uses it to
  //       insert the DB row and emit `IpcSessionInit` to the renderer,
  //       which promotes the pending thread into the sidebar.
  //
  //   (b) RESUMED thread (`resumeThreadId` passed): the SDK does NOT
  //       re-emit `thread.started` — from its perspective the thread
  //       already exists. So `initEmitted` stays `false` forever and
  //       we never produce an `init` SessionEvent for resumes. That's
  //       intentional and safe for today's consumers:
  //
  //         - main.ts already has the sessionId (it's the same as
  //           `resumeSessionId` the renderer passed) and the DB row
  //           already exists, so it doesn't need the event to persist
  //           anything.
  //         - The renderer's `Thread` object for a resumed thread was
  //           hydrated from `session:list-sessions` and already has
  //           `sessionId` / `provider` populated, so the
  //           `IpcSessionInit` reducer branch isn't needed.
  //
  // ── When this becomes a problem ─────────────────────────────────
  //
  //   If you add logic to `applyIpcEvent`'s `session_init` branch
  //   that MUST run for every thread, not just first-turn-of-new, it
  //   will silently skip Codex resumes. Examples of things that
  //   would break:
  //
  //     - Recording "user opened thread X in this app session" via
  //       session_init (would miss all resumed Codex threads).
  //     - Resetting per-session renderer state on init.
  //
  //   If you need a "thread is live again" hook that fires on both
  //   new and resumed Codex threads, don't rely on `init` — instead
  //   emit a synthetic event from `runOneTurn` before `turn.started`,
  //   or hook `status: "running"` in the renderer.
  private initEmitted = false;

  // The session id we expose via the `init` event. Populated after the
  // first `thread.started` event, or from a resume id in the ctor.
  private threadId: string | null = null;

  // The model label we echo on `init`. The Codex SDK doesn't emit the
  // active model on `thread.started`, so we capture whatever the
  // renderer selected at construction time. Falls back to "codex" when
  // the caller didn't pick one (the CLI will use its configured
  // default).
  private readonly modelLabel: string;

  constructor(opts?: CodexSessionOptions) {
    this.cwd = opts?.cwd;
    this.modelLabel = opts?.model ?? "codex";

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

    this.codex = new Codex({ codexPathOverride: "codex" });
    this.thread = opts?.resumeThreadId
      ? this.codex.resumeThread(opts.resumeThreadId, threadOptions)
      : this.codex.startThread(threadOptions);

    if (opts?.resumeThreadId) {
      this.threadId = opts.resumeThreadId;
    }
  }

  /**
   * Convert our IPC-level {@link ImageInput} into the Codex SDK's
   * `local_image` shape (which requires a filesystem path).
   *
   * - If the renderer already has a real path (Electron drag-drop sets
   *   `file.path` on OS-backed files), we forward it directly — no
   *   tempfile, no copy, no cleanup concern.
   * - Otherwise (clipboard paste, where the blob has no backing file),
   *   we materialize a tempfile at
   *   `<tmpdir>/openclawdex-codex-<uuid>.<ext>` and track it in the
   *   returned `tempPaths` array so the caller can clean up at
   *   end-of-turn.
   */
  private imagesToUserInput(
    text: string,
    images: ImageInput[],
  ): { input: Input; tempPaths: string[] } {
    const items: Input = [];
    const tempPaths: string[] = [];
    for (const img of images) {
      if (img.path) {
        items.push({ type: "local_image", path: img.path });
        continue;
      }
      const ext = img.mediaType.split("/")[1] ?? "png";
      const p = path.join(os.tmpdir(), `openclawdex-codex-${randomUUID()}.${ext}`);
      fs.writeFileSync(p, Buffer.from(img.base64, "base64"));
      tempPaths.push(p);
      items.push({ type: "local_image", path: p });
    }
    if (text) items.push({ type: "text", text });
    return { input: items, tempPaths };
  }

  send(
    message: string,
    images: ImageInput[] | undefined,
    onEvent: (e: SessionEvent) => void,
  ): void {
    let input: Input = message;
    let tempImagePaths: string[] = [];
    if (images && images.length > 0) {
      const prepared = this.imagesToUserInput(message, images);
      input = prepared.input;
      tempImagePaths = prepared.tempPaths;
    }

    this.queue.push({ input, onEvent, tempImagePaths });
    if (!this.draining) {
      this.draining = true;
      void this.driveQueue();
    }
  }

  /**
   * Process queued turns one at a time. Each turn: open a stream, fan
   * Codex events out to the caller's `onEvent`, then emit `done`, then
   * unlink any tempfiles created for that turn's images.
   */
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
    input: Input,
    onEvent: (e: SessionEvent) => void,
  ): Promise<void> {
    const abort = new AbortController();
    this.currentAbort = abort;

    // TODO(context-window): surface Codex context usage once we can
    // resolve the selected model's max-token limit. The SDK's `Usage`
    // payload exposes only `input_tokens + output_tokens`, not the
    // model-side context window, so we can compute a percentage only
    // if we hardcode (or look up) per-model limits. Until then we emit
    // `null` so the renderer hides the context-window donut entirely
    // for Codex threads (see ChatView's provider gate). Do NOT reinstate
    // the `{maxTokens: 0, percentage: 0}` sentinel that lived here
    // before — downstream `!= null` checks treat zero as "present" and
    // render a misleading "0% used, N / 0 tokens" tooltip.
    const lastUsage: ContextUsage | null = null;
    // Captured from JSON events on stdout. Preferred over the
    // `exited with code` wrapper the SDK throws, because that wrapper
    // only carries stderr (e.g. "Reading prompt from stdin...") while
    // the real reason (rate limit, auth, etc.) is in the JSON event.
    let turnError: string | null = null;
    this.agentMessageTextById.clear();

    try {
      const { events } = await this.thread.runStreamed(input, { signal: abort.signal });

      for await (const ev of events) {
        this.handleEvent(ev, onEvent);

        if (ev.type === "turn.failed") {
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
      this.agentMessageTextById.clear();
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
   * GOTCHA: the SDK's `agent_message` payload carries the full text
   * snapshot on every `item.updated` / `item.completed`, not a token
   * delta. We track the previous snapshot per item id and emit only
   * the newly appended suffix so the renderer can stream incrementally.
   *
   * TOOL CARDS: for tool-shaped items (shell, file_change, mcp, web
   * search, todo list) we emit a `tool_use` on BOTH `item.started`
   * and `item.completed`, reusing the SDK-provided `item.id` as
   * `toolUseId`. The renderer de-dupes on that id and updates the
   * card in place, so the user sees "$ npm install" appear as soon
   * as Codex decides to run it, then the same card fills in with
   * the output once it finishes. Without this pairing, long shell
   * commands would show no activity at all until they exited.
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
            // thread.started. Surface whatever the renderer selected
            // at ctor time so `SessionInfo.model` reads correctly in
            // the sidebar instead of the misleading literal "codex".
            model: this.modelLabel,
          });
        }
        break;
      }

      case "item.started":
      case "item.completed": {
        const item = ev.item;
        switch (item.type) {
          case "agent_message":
            if (ev.type === "item.started") {
              this.agentMessageTextById.set(item.id, item.text);
            } else {
              this.emitAgentMessageDelta(item.id, item.text, onEvent);
            }
            break;

          case "command_execution":
            // On started: command is known, output/exit_code not yet.
            // On completed: everything's filled in. Same id on both
            // so the renderer swaps the placeholder for the full card.
            onEvent({
              kind: "tool_use",
              toolUseId: item.id,
              toolName: "shell",
              toolInput: {
                command: item.command,
                output: item.aggregated_output,
                exit_code: item.exit_code,
              },
            });
            break;

          case "file_change":
            // file_change only emits on completion in practice (the
            // SDK treats it as atomic) but we still dedupe by id in
            // case that changes upstream.
            if (ev.type === "item.completed") {
              onEvent({
                kind: "tool_use",
                toolUseId: item.id,
                toolName: "apply_patch",
                toolInput: { changes: item.changes, status: item.status },
              });
            }
            break;

          case "mcp_tool_call":
            onEvent({
              kind: "tool_use",
              toolUseId: item.id,
              toolName: `${item.server}.${item.tool}`,
              toolInput: (item.arguments as Record<string, unknown>) ?? {},
            });
            break;

          case "web_search":
            onEvent({
              kind: "tool_use",
              toolUseId: item.id,
              toolName: "web_search",
              toolInput: { query: item.query },
            });
            break;

          case "todo_list":
            onEvent({
              kind: "tool_use",
              toolUseId: item.id,
              toolName: "update_plan",
              toolInput: { items: item.items },
            });
            break;

          case "reasoning":
            // Reasoning summaries aren't surfaced in the Claude flow
            // either; we skip them to keep the transcript tight.
            break;

          case "error":
            if (ev.type === "item.completed") {
              onEvent({ kind: "error", message: item.message });
            }
            break;
        }
        break;
      }

      case "turn.started":
      case "turn.completed":
      case "turn.failed":
      case "error":
        // Lifecycle events we handle in runOneTurn (or explicitly
        // ignore).
        break;

      case "item.updated": {
        const item = ev.item;
        if (item.type === "agent_message") {
          this.emitAgentMessageDelta(item.id, item.text, onEvent);
        }
        break;
      }
    }
  }

  private emitAgentMessageDelta(
    itemId: string,
    nextText: string,
    onEvent: (e: SessionEvent) => void,
  ): void {
    const prevText = this.agentMessageTextById.get(itemId) ?? "";
    if (nextText.length === 0 || nextText === prevText) return;

    if (nextText.startsWith(prevText)) {
      const delta = nextText.slice(prevText.length);
      this.agentMessageTextById.set(itemId, nextText);
      if (delta.length > 0) onEvent({ kind: "text_delta", text: delta });
      return;
    }

    // Unexpected non-append update shape. Fall back to emitting the
    // current snapshot once rather than stalling the transcript.
    this.agentMessageTextById.set(itemId, nextText);
    onEvent({ kind: "text_delta", text: nextText });
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
    // Drain any queued-but-unstarted turns and release their tempfiles.
    // In-flight turns clean up in `driveQueue`'s per-turn finally; this
    // only catches entries the user closed out before they began.
    for (const entry of this.queue) {
      for (const p of entry.tempImagePaths) safeUnlink(p);
    }
    this.queue = [];
    this.draining = false;
  }
}
