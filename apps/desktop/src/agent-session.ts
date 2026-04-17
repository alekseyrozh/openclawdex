/**
 * Provider-neutral agent session interface.
 *
 * Both {@link ClaudeSession} and {@link CodexSession} implement this contract
 * so the rest of the main process can hold a polymorphic
 * `Map<threadId, AgentSession>` and route work purely on `thread.provider`
 * (stored in the `known_threads.provider` column).
 *
 * GOTCHAS these types encode:
 * - `costUsd` / `durationMs` are `number | null` because Codex does not
 *   report a per-turn dollar cost (billing runs against the user's ChatGPT
 *   plan) and may not surface a duration. Claude always reports both.
 * - `deferredToolUse` is `DeferredToolUse | null` because Codex has no
 *   equivalent of Claude's AskUserQuestion pause-for-input protocol —
 *   Codex adapters always set it to null.
 * - `respondToTool` is a no-op for Codex; only Claude's AskUserQuestion
 *   path ever invokes it.
 */

import type { Provider } from "@openclawdex/shared";

export type ImageInput = { name: string; base64: string; mediaType: string };

export type ContextUsage = {
  totalTokens: number;
  maxTokens: number;
  percentage: number;
};

export type DeferredToolUse = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type SessionEvent =
  | { kind: "init"; sessionId: string; model: string }
  | { kind: "text_delta"; text: string }
  | { kind: "tool_use"; toolName: string; toolInput: Record<string, unknown> }
  | {
      kind: "result";
      // `null` for Codex (no cost reporting); always a number for Claude.
      costUsd: number | null;
      // `null` for Codex (not surfaced by the SDK); always a number for Claude.
      durationMs: number | null;
      isError: boolean;
      contextUsage: ContextUsage | null;
      // Always `null` for Codex (no AskUserQuestion analogue).
      deferredToolUse: DeferredToolUse | null;
    }
  | { kind: "error"; message: string }
  | { kind: "done" };

/**
 * One multi-turn conversation with a coding agent backend.
 *
 * Implementations wrap a provider-specific SDK (Anthropic Claude SDK or
 * OpenAI Codex SDK) and map its native event stream onto the uniform
 * {@link SessionEvent} union above.
 */
export interface AgentSession {
  readonly provider: Provider;

  /**
   * Send a user message. The first call starts the underlying turn-stream;
   * subsequent calls push follow-up turns into the same session.
   *
   * Streamed events arrive via `onEvent`. Implementations must emit:
   *   - exactly one `init` event per session (the first time a
   *     session/thread id is available), and
   *   - at least one `result` event per turn before the turn's `done`.
   */
  send(
    message: string,
    images: ImageInput[] | undefined,
    onEvent: (e: SessionEvent) => void,
  ): void;

  /** Interrupt the current turn. Safe to call when idle (no-op). */
  interrupt(): Promise<void>;

  /**
   * Respond to a deferred tool call. Only meaningful for Claude's
   * AskUserQuestion — Codex implementations make this a no-op because
   * the Codex SDK does not surface a pause-for-input protocol.
   */
  respondToTool(toolUseId: string, text: string): void;

  /** Close the session entirely and release any child-process handles. */
  close(): void;
}
