import { execSync } from "child_process";
import {
  query,
  type SDKMessage,
  type SDKUserMessage,
  type Options as ClaudeQueryOptions,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentSession,
  ContextUsage,
  DeferredToolUse,
  ImageInput,
  SessionEvent,
} from "./agent-session";

// Re-export the shared types so existing imports from "./claude" keep working
// while we migrate call sites over to "./agent-session".
export type { AgentSession, ContextUsage, DeferredToolUse, ImageInput, SessionEvent };

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
  private queryInstance: ReturnType<typeof query> | null = null;
  private streamLoopRunning = false;

  // Async queue for feeding user messages into the SDK's prompt iterable
  private messageQueue: SDKUserMessage[] = [];
  private messageResolve: ((value: IteratorResult<SDKUserMessage>) => void) | null = null;
  private closed = false;

  private cwd: string | undefined;

  constructor(claudePath: string, opts?: { resumeSessionId?: string; cwd?: string }) {
    this.claudePath = claudePath;
    this.resumeSessionId = opts?.resumeSessionId;
    this.cwd = opts?.cwd;
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
      resume: this.resumeSessionId,
      cwd: this.cwd,
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

          // Check for deferred tool use (e.g. AskUserQuestion)
          const msgRecord = msg as Record<string, unknown>;
          const rawDeferred = msgRecord.deferred_tool_use as { id: string; name: string; input: Record<string, unknown> } | undefined;
          const deferredToolUse: DeferredToolUse | null = rawDeferred
            ? { id: rawDeferred.id, name: rawDeferred.name, input: rawDeferred.input }
            : null;

          if (deferredToolUse) {
          }

          onEvent({
            kind: "result",
            costUsd: msg.total_cost_usd,
            durationMs: msg.duration_ms,
            isError: msg.is_error,
            contextUsage,
            deferredToolUse,
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
        // Complete assistant message — extract tool_use blocks (text already sent via deltas)
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
   * Respond to a deferred tool call (e.g. AskUserQuestion).
   * Pushes a user message with `parent_tool_use_id` so the SDK
   * routes it as the tool result, allowing Claude to continue.
   */
  respondToTool(toolUseId: string, text: string): void {
    this.enqueueMessage({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: toolUseId,
    });
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
    try {
      this.queryInstance?.return(undefined);
    } catch {
      /* ignore */
    }
    this.queryInstance = null;
    this.streamLoopRunning = false;
  }

}
