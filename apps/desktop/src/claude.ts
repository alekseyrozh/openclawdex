import { execSync } from "child_process";
import { randomUUID } from "crypto";
import {
  query,
  type SDKMessage,
  type SDKUserMessage,
  type Options as ClaudeQueryOptions,
  type CanUseTool,
  type PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeEffortLevel } from "@openclawdex/shared";
import type {
  AgentSession,
  ContextUsage,
  ImageInput,
  PendingRequest,
  RequestResolution,
  SessionEvent,
} from "./agent-session";

// Re-export the shared types so existing imports from "./claude" keep working
// while we migrate call sites over to "./agent-session".
export type { AgentSession, ContextUsage, ImageInput, PendingRequest, RequestResolution, SessionEvent };

/**
 * Locate the `claude` binary on the system.
 * Tries `which` first, then common install locations.
 */
export function findClaudeBinary(): string | null {
  try {
    return execSync("which claude", { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

/**
 * One multi-turn conversation with Claude Code via the Agent SDK.
 *
 * Uses `query()` with an async-iterable prompt so we can push
 * follow-up messages into the same session.
 *
 * Implements {@link AgentSession} so it can be stored alongside
 * {@link CodexSession} in a single `Map<threadId, AgentSession>` in
 * `main.ts`.
 */
export class ClaudeSession implements AgentSession {
  readonly provider = "claude" as const;

  private claudePath: string;
  private resumeSessionId: string | undefined;
  private model: string | undefined;
  private effort: ClaudeEffortLevel | undefined;
  private queryInstance: ReturnType<typeof query> | null = null;
  private streamLoopRunning = false;

  // Async queue for feeding user messages into the SDK's prompt iterable
  private messageQueue: SDKUserMessage[] = [];
  private messageResolve: ((value: IteratorResult<SDKUserMessage>) => void) | null = null;
  private closed = false;

  // Pending AskUserQuestion Promises keyed by the requestId we emitted
  // to the renderer. The SDK's canUseTool callback stores a resolver
  // here and awaits it; resolveRequest() looks it up and fulfills the
  // Promise with the answers the user picked in the UI. This is the
  // ONLY correct way to feed AskUserQuestion answers back to the CLI —
  // the older "push a user message with parent_tool_use_id" approach
  // looks plausible but actually bypasses the tool, which then self-
  // reports as dismissed in its synthetic tool_result ("It looks like
  // the questions were dismissed.").
  private pendingAskQuestions = new Map<
    string,
    {
      resolve: (r: PermissionResult) => void;
      rawQuestions: unknown;
    }
  >();

  private cwd: string | undefined;

  constructor(
    claudePath: string,
    opts?: {
      resumeSessionId?: string;
      cwd?: string;
      model?: string;
      effort?: ClaudeEffortLevel;
    },
  ) {
    this.claudePath = claudePath;
    this.resumeSessionId = opts?.resumeSessionId;
    this.cwd = opts?.cwd;
    this.model = opts?.model;
    this.effort = opts?.effort;
  }

  private static toUserMessage(text: string, images?: ImageInput[]): SDKUserMessage {
    // If there are images, build a content block array (text + image blocks)
    if (images && images.length > 0) {
      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
      > = [];

      for (const img of images) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: img.mediaType,
            data: img.base64,
          },
        });
      }

      if (text) {
        content.push({ type: "text", text });
      }

      return {
        type: "user",
        message: { role: "user", content: content as unknown as string },
        parent_tool_use_id: null,
      };
    }

    return {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    };
  }

  private enqueueMessage(msg: SDKUserMessage) {
    if (this.messageResolve) {
      const resolve = this.messageResolve;
      this.messageResolve = null;
      resolve({ value: msg, done: false });
    } else {
      this.messageQueue.push(msg);
    }
  }

  private pushMessage(text: string, images?: ImageInput[]) {
    this.enqueueMessage(ClaudeSession.toUserMessage(text, images));
  }

  private closeQueue() {
    this.closed = true;
    if (this.messageResolve) {
      const resolve = this.messageResolve;
      this.messageResolve = null;
      resolve({ value: undefined as unknown as SDKUserMessage, done: true });
    }
  }

  /** The async iterable that feeds the SDK's prompt parameter */
  private promptIterable(): AsyncIterable<SDKUserMessage> {
    const self = this;
    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<SDKUserMessage>> {
            if (self.closed) {
              return Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true });
            }
            if (self.messageQueue.length > 0) {
              return Promise.resolve({
                value: self.messageQueue.shift()!,
                done: false,
              });
            }
            return new Promise((resolve) => {
              self.messageResolve = resolve;
            });
          },
        };
      },
    };
  }

  /**
   * Build the `canUseTool` callback passed to `query()`. The callback
   * is invoked by the SDK once per tool call the model wants to make.
   *
   * For `AskUserQuestion`: we stash a resolver keyed by a fresh
   * `requestId`, emit a `pending_request` session event so the
   * renderer can present the QuestionCard, and return a Promise that
   * the `resolveRequest` method will fulfill once the user submits.
   * The SDK then runs the tool with `updatedInput` containing both the
   * original questions and the user's answers — the tool echoes those
   * answers in its `tool_result`, and the model sees them as the
   * normal tool output.
   *
   * For every other tool: return `{behavior: "allow"}` immediately so
   * `permissionMode: "bypassPermissions"` is preserved — we're only
   * intercepting to handle AskUserQuestion, not to gate anything.
   */
  private buildCanUseTool(onEvent: (e: SessionEvent) => void): CanUseTool {
    return async (toolName, toolInput, options): Promise<PermissionResult> => {
      if (toolName !== "AskUserQuestion") {
        // Every other tool is pre-approved (we ship with
        // `permissionMode: "bypassPermissions"`). We're only
        // intercepting to handle AskUserQuestion, so fall through to
        // allow with the unmodified input.
        return { behavior: "allow" };
      }

      const requestId = randomUUID();
      const request: PendingRequest = {
        kind: "ask_user_question",
        requestId,
        toolName,
        input: toolInput,
      };

      const answerPromise = new Promise<PermissionResult>((resolve) => {
        this.pendingAskQuestions.set(requestId, {
          resolve,
          rawQuestions: toolInput.questions,
        });
      });

      // If the SDK's abort signal fires (e.g. the user interrupted the
      // turn while we were waiting for answers), resolve with `deny` so
      // the SDK can unwind cleanly instead of hanging forever.
      const onAbort = () => {
        const pending = this.pendingAskQuestions.get(requestId);
        if (!pending) return;
        this.pendingAskQuestions.delete(requestId);
        pending.resolve({
          behavior: "deny",
          message: "User cancelled before answering.",
          interrupt: true,
        });
      };
      options.signal.addEventListener("abort", onAbort, { once: true });

      onEvent({ kind: "pending_request", request });

      return answerPromise;
    };
  }

  /**
   * Send a user message. Streamed events come back via `onEvent`.
   * On the first call, starts the SDK query. Follow-up calls push
   * into the same session.
   */
  send(message: string, images: ImageInput[] | undefined, onEvent: (e: SessionEvent) => void): void {
    this.pushMessage(message, images);

    if (this.streamLoopRunning) return;
    this.streamLoopRunning = true;

    const options: ClaudeQueryOptions = {
      pathToClaudeCodeExecutable: this.claudePath,
      includePartialMessages: true,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      canUseTool: this.buildCanUseTool(onEvent),
      resume: this.resumeSessionId,
      cwd: this.cwd,
      ...(this.model && { model: this.model }),
      ...(this.effort && { effort: this.effort }),
    };

    this.queryInstance = query({
      prompt: this.promptIterable(),
      options,
    });

    this.consumeStream(onEvent);
  }

  private async consumeStream(onEvent: (e: SessionEvent) => void): Promise<void> {
    try {
      for await (const msg of this.queryInstance!) {
        if (msg.type === "result") {
          // Call getContextUsage here — queryInstance is provably alive inside the loop.
          let contextUsage: ContextUsage | null = null;
          try {
            const u = await this.queryInstance?.getContextUsage();

            if (u != null) {
              contextUsage = { totalTokens: u.totalTokens, maxTokens: u.maxTokens, percentage: u.percentage };
            }
          } catch (err) {
            console.error("[claude] getContextUsage failed:", err);
          }

          onEvent({
            kind: "result",
            costUsd: msg.total_cost_usd,
            durationMs: msg.duration_ms,
            isError: msg.is_error,
            contextUsage,
          });
        } else {
          this.handleMessage(msg, onEvent);
        }
      }
    } catch (err) {
      onEvent({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.streamLoopRunning = false;
      this.queryInstance = null;
      onEvent({ kind: "done" });
    }
  }

  private handleMessage(msg: SDKMessage, onEvent: (e: SessionEvent) => void): void {
    switch (msg.type) {
      case "system": {
        if (msg.subtype === "init") {
          onEvent({
            kind: "init",
            sessionId: msg.session_id,
            model: msg.model,
          });
        }
        break;
      }

      case "stream_event": {
        // SDKPartialAssistantMessage — contains Anthropic API streaming events
        const event = msg.event;
        if (
          event.type === "content_block_delta" &&
          "delta" in event &&
          event.delta.type === "text_delta"
        ) {
          onEvent({ kind: "text_delta", text: event.delta.text });
        }
        break;
      }

      case "assistant": {
        // Complete assistant message — extract tool_use blocks (text already sent via deltas).
        // Note: AskUserQuestion is surfaced here like any other tool use
        // so the renderer can render the QuestionCard in the chat
        // transcript; the accompanying `pending_request` event (emitted
        // from the canUseTool callback) only carries the opaque
        // `requestId` the renderer needs to route answers back. Both
        // events reference the same question, so the renderer keys the
        // card on the tool_use entry and resolves via the pending
        // request.
        const content = (msg as { message?: { content?: unknown } }).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block && typeof block === "object" && (block as { type?: string }).type === "tool_use") {
              const name = (block as { name?: string }).name;
              const input = (block as { input?: Record<string, unknown> }).input ?? {};
              if (name) onEvent({ kind: "tool_use", toolName: name, toolInput: input });
            }
          }
        }
        break;
      }

      // All other message types (rate_limit_event, tool_progress, etc.) — ignore
    }
  }

  /**
   * Resolve a pending request. For `ask_user_question` we fulfill the
   * stored `canUseTool` Promise with `{behavior: "allow", updatedInput:
   * {questions, answers}}` — the SDK then runs AskUserQuestion with
   * those pre-filled answers and the model sees them as the tool's
   * normal output. If no resolver exists for the requestId (e.g. the
   * renderer is replaying an old thread) this is a silent no-op.
   */
  resolveRequest(resolution: RequestResolution): void {
    switch (resolution.kind) {
      case "ask_user_question": {
        const pending = this.pendingAskQuestions.get(resolution.requestId);
        if (!pending) return;
        this.pendingAskQuestions.delete(resolution.requestId);
        pending.resolve({
          behavior: "allow",
          updatedInput: {
            questions: pending.rawQuestions,
            answers: resolution.answers,
          },
        });
        return;
      }
    }
  }

  /** Interrupt the current turn. */
  async interrupt(): Promise<void> {
    try {
      await this.queryInstance?.interrupt();
    } catch {
      /* ignore if already stopped */
    }
  }

  /** Close the session entirely. */
  close(): void {
    this.closeQueue();
    // Fail any in-flight AskUserQuestion Promises so the SDK unwinds
    // cleanly rather than leaking hung canUseTool callbacks.
    for (const [, pending] of this.pendingAskQuestions) {
      pending.resolve({
        behavior: "deny",
        message: "Session closed.",
        interrupt: true,
      });
    }
    this.pendingAskQuestions.clear();
    try {
      this.queryInstance?.return(undefined);
    } catch {
      /* ignore */
    }
    this.queryInstance = null;
    this.streamLoopRunning = false;
  }

}
