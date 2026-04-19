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
 * - `pendingRequest` is `PendingRequest | null` — a discriminated union
 *   covering every "agent paused waiting for the user" flow (today:
 *   `ask_user_question`; future: approval/plan variants). Backends that
 *   don't surface the current kind always set it to null.
 * - `resolveRequest` is the inverse — receives a typed resolution
 *   variant and routes it into the backend's native mechanism (Claude:
 *   user message with `parent_tool_use_id`; Codex: reply to a paused
 *   approval RPC — future). No-op on backends that don't know the kind.
 */

import type { PendingRequest, Provider, RequestResolution, UserMode } from "@openclawdex/shared";

export type { PendingRequest, RequestResolution, UserMode };

/**
 * One image attachment on an outgoing user message.
 *
 * We always carry `name` + `mediaType` + `base64`. `path` is set only
 * when the renderer got the file from a source that has a filesystem
 * path (Electron drag-drop from the OS sets `File.path`); clipboard
 * pastes yield blob-only images and leave `path` undefined. Backends
 * that can consume paths directly (Codex, via `local_image`) prefer
 * `path` to avoid a tempfile round-trip.
 */
export type ImageInput = {
  name: string;
  base64: string;
  mediaType: string;
  path?: string;
};

export type ContextUsage = {
  totalTokens: number;
  maxTokens: number;
  percentage: number;
};

export type SessionEvent =
  | { kind: "init"; sessionId: string; model: string }
  | { kind: "text_delta"; text: string }
  /**
   * A tool invocation. When `toolUseId` is set and the renderer has
   * already rendered a card with the same id, it updates the card in
   * place instead of appending a new one. Codex uses this to show the
   * shell command / file change immediately on `item.started` and
   * then replace the card with completed output on `item.completed`.
   * Claude always emits once per tool call and can omit the id.
   */
  | {
      kind: "tool_use";
      toolUseId?: string;
      toolName: string;
      toolInput: Record<string, unknown>;
    }
  | {
      kind: "result";
      // `null` for Codex (no cost reporting); always a number for Claude.
      costUsd: number | null;
      // `null` for Codex (not surfaced by the SDK); always a number for Claude.
      durationMs: number | null;
      isError: boolean;
      contextUsage: ContextUsage | null;
    }
  /**
   * The agent has paused and is waiting on the user. Emitted mid-turn
   * (NOT inside a `result` event) because the pause happens inside the
   * SDK's `canUseTool` callback — before the turn's `result` is
   * produced. The renderer stashes the request on the thread, shows
   * the appropriate UI, and eventually calls `resolveRequest` on the
   * session to unblock the backend.
   */
  | { kind: "pending_request"; request: PendingRequest }
  /**
   * The session's effective UserMode changed. Fires both when the user
   * switches modes via the UI (IPC round-trip echoes this back for
   * reconciliation) and when the model flips its own mode via
   * `EnterPlanMode` / `ExitPlanMode` (detected in the streamed tool
   * results). Renderer treats this as the authoritative path for
   * `thread.userMode`.
   */
  | { kind: "mode_changed"; mode: UserMode }
  /**
   * A `<proposed_plan>` block extracted from an assistant message when
   * no approval is wanted (e.g. Codex outside plan mode — the tag is a
   * rendering hint, not a gate). The renderer appends it to the
   * transcript as a read-only plan card. In plan mode the backend
   * emits a `pending_request` with `exit_plan_approval` instead.
   */
  | { kind: "plan_card"; plan: string }
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
   * Change the effective {@link UserMode} for this session. Emits a
   * `mode_changed` event via `onEvent` so the renderer can reconcile.
   * For Claude, this flips the live SDK query's permission mode
   * immediately (future tool calls see the new gate) — the returned
   * Promise resolves only after the SDK accepts the flip, so callers
   * never see an optimistic UI update that silently diverges from the
   * CLI's actual state. For Codex, the new mode applies on the next
   * `turn/start` — the current turn, if any, keeps its existing
   * policies.
   */
  setMode(mode: UserMode, onEvent: (e: SessionEvent) => void): Promise<void>;

  /**
   * Resolve a {@link PendingRequest} previously emitted on a `result`
   * event. The `resolution.kind` must match the request's `kind`;
   * backends dispatch on it to route into their native protocol.
   * Unknown kinds are silently ignored (future-variant safety).
   */
  resolveRequest(resolution: RequestResolution): Promise<void>;

  /** Close the session entirely and release any child-process handles. */
  close(): void;
}
