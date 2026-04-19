import { execSync } from "child_process";
import { randomUUID } from "crypto";
import {
  query,
  type SDKMessage,
  type SDKUserMessage,
  type Options as ClaudeQueryOptions,
  type CanUseTool,
  type HookInput,
  type HookJSONOutput,
  type PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeEffortLevel, UserMode } from "@openclawdex/shared";
import type {
  AgentSession,
  ContextUsage,
  ImageInput,
  PendingRequest,
  RequestResolution,
  SessionEvent,
} from "./agent-session";
import { CLAUDE_MODE, claudePermissionModeToUserMode } from "./user-mode";

/**
 * Read-only tools — we never prompt for these, regardless of mode.
 * Auto-allowing keeps the UX sane: prompting for every Read or Grep
 * would bury users in approval cards with no security benefit.
 * `TodoWrite` is included because it only mutates the in-session
 * todo list, not the user's filesystem.
 */
const READ_ONLY_TOOLS = new Set([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "ToolSearch",
  "WebFetch",
  "WebSearch",
  "StructuredOutput",
  "TodoWrite",
]);

/**
 * Privileged tools — prompt in BOTH "ask" and "acceptEdits" modes.
 * These can do arbitrary things on the user's machine (run shell
 * commands, spawn subagents that run shell commands, etc.), so the
 * "acceptEdits" shortcut — which auto-allows file edits — still
 * requires explicit approval for them.
 */
const PRIVILEGED_TOOLS = new Set([
  "Bash",
  "Agent",
  "Task",
]);

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

  // Pending ExitPlanMode approvals keyed by requestId. Same pattern as
  // pendingAskQuestions — canUseTool stashes a resolver; resolveRequest
  // fulfills it with `allow` (user approved the plan) or `deny` (user
  // rejected). Separate from pendingAskQuestions so the id namespaces
  // don't collide and the dispatch in resolveRequest stays obvious.
  private pendingExitPlanApprovals = new Map<
    string,
    {
      resolve: (r: PermissionResult) => void;
      toolInput: Record<string, unknown>;
    }
  >();

  // Per-tool approvals awaiting a user decision. Same stash/resolve
  // pattern as AskUserQuestion — canUseTool awaits the Promise,
  // resolveRequest fulfills it.
  private pendingToolApprovals = new Map<
    string,
    {
      resolve: (r: PermissionResult) => void;
      toolInput: Record<string, unknown>;
    }
  >();

  // Most recent `onEvent` callback, captured on send(). Lets handlers
  // that run outside the send-callback closure (e.g. resolveRequest,
  // which is fired from a separate IPC message) emit SessionEvents
  // without every caller having to re-plumb the callback.
  private lastOnEvent: ((e: SessionEvent) => void) | null = null;

  private cwd: string | undefined;

  // Cached copy of the SDK's current permission mode — NOT a source of
  // truth. Seeded from the constructor / SDKSystemMessage init, then
  // reconciled on every tool event via the PreToolUse hook (which
  // reads `permission_mode` off BaseHookInput). User-initiated flips
  // and plan approvals update this optimistically for UI snappiness;
  // the hook corrects any drift.
  private userMode: UserMode;

  // When the user flips mode via setMode, we stash the target here so
  // the hook-based reconciler doesn't race-revert our change before
  // the SDK catches up. Cleared once the hook observes the expected
  // mode (confirmation) OR once a tool call happens (we've waited long
  // enough — trust user intent). Without this guard, mid-stream
  // setPermissionMode updates that fail to propagate in the SDK cause
  // the next PreToolUse hook to read the stale mode and overwrite
  // `userMode`, undoing the user's switch.
  private pendingUserModeIntent: UserMode | null = null;

  constructor(
    claudePath: string,
    opts?: {
      resumeSessionId?: string;
      cwd?: string;
      model?: string;
      effort?: ClaudeEffortLevel;
      userMode?: UserMode;
    },
  ) {
    this.claudePath = claudePath;
    this.resumeSessionId = opts?.resumeSessionId;
    this.cwd = opts?.cwd;
    this.model = opts?.model;
    this.effort = opts?.effort;
    this.userMode = opts?.userMode ?? "acceptEdits";
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
   * Reconcile our cached `userMode` against the SDK's ground truth.
   * Called from the PreToolUse hook on every tool event and from the
   * init message. If the SDK reports a mode we haven't recorded yet
   * (user flip we didn't predict, ExitPlanMode transition, a tool's
   * internal permission update, etc.), we update the cache and emit
   * `mode_changed` so the renderer dropdown converges to truth.
   */
  private reconcileModeFromSdk(raw: string | undefined): void {
    if (!raw) return;

    // Pending user intent always wins while the SDK catches up.
    // Clear the flag once the SDK confirms the expected mode.
    if (this.pendingUserModeIntent !== null) {
      const expectedSdk = CLAUDE_MODE[this.pendingUserModeIntent];
      if (raw === expectedSdk) {
        // console.log(`[claude] reconcile: SDK confirmed ${expectedSdk} (user wanted ${this.pendingUserModeIntent}) — clearing pending`);
        this.pendingUserModeIntent = null;
      } else {
        // console.log(`[claude] reconcile: SDK says ${raw} but user wanted ${this.pendingUserModeIntent} (sdk ${expectedSdk}) — ignoring`);
      }
      return;
    }

    // If the SDK reports `acceptEdits` or `bypassPermissions`, force
    // it back to `"default"`. Our architecture relies on the SDK
    // being in `"default"` (so `canUseTool` fires for every tool) or
    // `"plan"` (for the special plan-mode semantics). A resumed
    // session could come up in acceptEdits/bypass if it was started
    // under older code or if the SDK persists the mode across
    // resume — either way, leaving it there means the SDK auto-
    // accepts at its own layer and bypasses our gate entirely.
    if (raw === "acceptEdits" || raw === "bypassPermissions") {
      // console.log(`[claude] reconcile: SDK reports ${raw}, forcing to "default" so our gate regains control`);
      const q = this.queryInstance;
      if (q) {
        q.setPermissionMode("default").catch((err) => {
          console.error(`[claude] force-flip to default failed:`, err);
        });
      }
      return;
    }

    // With CLAUDE_MODE pinning ask/acceptEdits/bypass all to SDK
    // "default", SDK-reported "default" is ambiguous — it could mean
    // any of the three. Never overwrite `userMode` based on a
    // "default" report; the user's own setMode is authoritative for
    // those three.
    //
    // The ONLY unambiguous SDK-driven transition we care about is
    // plan ↔ non-plan (ExitPlanMode's auto-transition on approval,
    // or SDK entering plan mode via its own path).
    const sdkInPlan = raw === "plan";
    const userInPlan = this.userMode === "plan";

    if (sdkInPlan && !userInPlan) {
      // console.log(`[claude] reconcile: SDK entered plan — updating userMode`);
      this.userMode = "plan";
      this.lastOnEvent?.({ kind: "mode_changed", mode: "plan" });
      return;
    }

    if (!sdkInPlan && userInPlan) {
      // ExitPlanMode approved — Claude's native post-plan default is
      // acceptEdits ("ready to implement"). User can flip afterward
      // if they wanted something else.
      // console.log(`[claude] reconcile: SDK left plan — transitioning to acceptEdits`);
      this.userMode = "acceptEdits";
      this.lastOnEvent?.({ kind: "mode_changed", mode: "acceptEdits" });
      return;
    }

    // sdk=default + user=non-plan  OR  sdk=plan + user=plan → no-op.
  }

  /**
   * Mode-reconcile hook — wired to multiple lifecycle events
   * (PreToolUse, PostToolUse, Stop, UserPromptSubmit) so we observe
   * `permission_mode` off the hook input at every plausible moment
   * the CLI's mode could shift. We don't gate anything here (that's
   * `canUseTool`'s job); we only sync our cached `userMode` to ground
   * truth. Returning `{ continue: true }` is the hook equivalent of
   * "no-op, proceed".
   *
   * Why multiple taps: PreToolUse alone misses transitions caused by
   * the *current* tool (ExitPlanMode flips mode in its handler — we
   * see that on PostToolUse, not PreToolUse) and transitions that
   * land at end of turn with no follow-up tool call (Stop).
   */
  private buildModeReconcileHook(): (input: HookInput) => Promise<HookJSONOutput> {
    return async (input: HookInput): Promise<HookJSONOutput> => {
      this.reconcileModeFromSdk(input.permission_mode);
      return { continue: true };
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
      // console.log(`[claude] canUseTool: ${toolName} userMode=${this.userMode}`);
      // Special-case tools always take precedence over mode logic.
      if (toolName === "AskUserQuestion") {
        return this.interceptAskUserQuestion(toolInput, options, onEvent);
      }
      if (toolName === "ExitPlanMode") {
        return this.interceptExitPlanMode(toolInput, options, onEvent);
      }

      // Decide whether this tool needs an approval prompt given the
      // current UserMode. We MUST echo `updatedInput: toolInput` on
      // allow — the SDK validates the response shape with Zod in all
      // non-bypass modes and rejects bare `{behavior: "allow"}` with
      // "Invalid input: expected record, received undefined".
      const allow: PermissionResult = { behavior: "allow", updatedInput: toolInput };

      // Bypass and plan modes: no prompting. In plan mode, the SDK's
      // own mode gate blocks mutating tools before they run — we
      // shouldn't also prompt because the user already picked plan
      // mode with full knowledge that edits are blocked.
      if (this.userMode === "bypassPermissions" || this.userMode === "plan") {
        return allow;
      }

      // Read-only tools never prompt.
      if (READ_ONLY_TOOLS.has(toolName)) return allow;

      // acceptEdits mode: file-edit tools pass through; privileged
      // (Bash / Agent / Task) still prompt. Anything we don't
      // recognize falls into "prompt" for safety.
      if (this.userMode === "acceptEdits" && !PRIVILEGED_TOOLS.has(toolName)) {
        return allow;
      }

      // ask mode (or acceptEdits + privileged tool, or unknown tool
      // in acceptEdits): prompt the user.
      return this.interceptToolApproval(toolName, toolInput, options, onEvent);
    };
  }

  /** canUseTool gate for AskUserQuestion — paused until the UI answers. */
  private async interceptAskUserQuestion(
    toolInput: Record<string, unknown>,
    options: { signal: AbortSignal },
    onEvent: (e: SessionEvent) => void,
  ): Promise<PermissionResult> {
    const requestId = randomUUID();
    const request: PendingRequest = {
      kind: "ask_user_question",
      requestId,
      toolName: "AskUserQuestion",
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
  }

  /**
   * canUseTool gate for arbitrary mutating / privileged tools when
   * the session is in "ask" mode (or "acceptEdits" for shell-like
   * tools). Emits a `tool_approval` pending request carrying the
   * tool name and its input, blocks until the user decides.
   *
   * Input preview rendering (diff for Edit, command for Bash, etc.)
   * lives in the renderer's `ToolApprovalCard` — we just carry the
   * raw `toolInput` across the IPC boundary so we don't lock the
   * preview logic to the main process.
   */
  private async interceptToolApproval(
    toolName: string,
    toolInput: Record<string, unknown>,
    options: { signal: AbortSignal },
    onEvent: (e: SessionEvent) => void,
  ): Promise<PermissionResult> {
    const requestId = randomUUID();
    const request: PendingRequest = {
      kind: "tool_approval",
      requestId,
      toolName,
      toolInput,
    };

    const answerPromise = new Promise<PermissionResult>((resolve) => {
      this.pendingToolApprovals.set(requestId, { resolve, toolInput });
    });

    const onAbort = () => {
      const pending = this.pendingToolApprovals.get(requestId);
      if (!pending) return;
      this.pendingToolApprovals.delete(requestId);
      pending.resolve({
        behavior: "deny",
        message: "User cancelled before approving the tool call.",
        interrupt: true,
      });
    };
    options.signal.addEventListener("abort", onAbort, { once: true });

    onEvent({ kind: "pending_request", request });

    return answerPromise;
  }

  /**
   * canUseTool gate for ExitPlanMode. The SDK marks this tool
   * `shouldDefer: true`, meaning native Claude Code would render its
   * own "Apply plan?" dialog. In our wrapper we instead emit a
   * `pending_request` with the plan markdown, show a PlanApprovalCard
   * in the renderer, and block on the user's choice.
   *
   * On approve: resolve with `allow`, flip userMode off plan, emit
   * `mode_changed` so the dropdown reflects the transition.
   * On reject: resolve with `deny` — the agent sees a failure and
   * stays in plan mode.
   */
  private async interceptExitPlanMode(
    toolInput: Record<string, unknown>,
    options: { signal: AbortSignal },
    onEvent: (e: SessionEvent) => void,
  ): Promise<PermissionResult> {
    const requestId = randomUUID();
    const rawPlan = toolInput.plan;
    const plan = typeof rawPlan === "string" ? rawPlan : "";
    const rawFilePath = toolInput.planFilePath;
    const planFilePath = typeof rawFilePath === "string" ? rawFilePath : undefined;

    const request: PendingRequest = {
      kind: "exit_plan_approval",
      requestId,
      toolName: "ExitPlanMode",
      plan,
      ...(planFilePath && { planFilePath }),
    };

    const answerPromise = new Promise<PermissionResult>((resolve) => {
      this.pendingExitPlanApprovals.set(requestId, { resolve, toolInput });
    });

    const onAbort = () => {
      const pending = this.pendingExitPlanApprovals.get(requestId);
      if (!pending) return;
      this.pendingExitPlanApprovals.delete(requestId);
      pending.resolve({
        behavior: "deny",
        message: "User cancelled before approving the plan.",
        interrupt: true,
      });
    };
    options.signal.addEventListener("abort", onAbort, { once: true });

    onEvent({ kind: "pending_request", request });

    return answerPromise;
  }

  /**
   * Send a user message. Streamed events come back via `onEvent`.
   * On the first call, starts the SDK query. Follow-up calls push
   * into the same session.
   */
  send(message: string, images: ImageInput[] | undefined, onEvent: (e: SessionEvent) => void): void {
    this.lastOnEvent = onEvent;
    this.pushMessage(message, images);

    if (this.streamLoopRunning) return;
    this.streamLoopRunning = true;

    const options: ClaudeQueryOptions = {
      pathToClaudeCodeExecutable: this.claudePath,
      includePartialMessages: true,
      // Only `plan` uses its native SDK mode — see CLAUDE_MODE in
      // user-mode.ts for why the other three all map to "default".
      // We intentionally don't pass allowDangerouslySkipPermissions:
      // bypass semantics are implemented in our `canUseTool` gate,
      // not by asking the SDK to skip its own prompts.
      permissionMode: CLAUDE_MODE[this.userMode],
      canUseTool: this.buildCanUseTool(onEvent),
      // Observe the CLI's actual `permission_mode` at every lifecycle
      // event we can hook and reconcile our cached `userMode` against
      // it. This catches any mode transition we didn't predict —
      // whether it originated from our own `setPermissionMode`, from
      // a tool's internal permission update (e.g. ExitPlanMode's
      // handler), or from a future CLI change — without us having to
      // enumerate them. PreToolUse alone misses end-of-turn flips
      // (no follow-up tool) and flips caused by the current tool
      // (ExitPlanMode mutates mode mid-handler — visible only on
      // PostToolUse). One callback, four taps.
      hooks: (() => {
        const reconcile = this.buildModeReconcileHook();
        const matcher = [{ hooks: [reconcile] }];
        return {
          PreToolUse: matcher,
          PostToolUse: matcher,
          Stop: matcher,
          UserPromptSubmit: matcher,
        };
      })(),
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
          // Init carries the authoritative permission mode the CLI is
          // starting (or resuming) in. Reconcile before emitting the
          // init event so any downstream consumer reading `userMode`
          // sees ground truth.
          const initMode = (msg as { permissionMode?: string }).permissionMode;
          this.reconcileModeFromSdk(initMode);
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
        //
        // Mode transitions (ExitPlanMode, etc.) are NOT handled here —
        // the PreToolUse hook reconciles `userMode` against the CLI's
        // authoritative `permission_mode` on every tool event, so we
        // don't need to sniff tool names and guess.
        const content = (msg as { message?: { content?: unknown } }).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block && typeof block === "object" && (block as { type?: string }).type === "tool_use") {
              const name = (block as { name?: string }).name;
              const input = (block as { input?: Record<string, unknown> }).input ?? {};
              if (name) {
                onEvent({ kind: "tool_use", toolName: name, toolInput: input });
              }
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
  async resolveRequest(resolution: RequestResolution): Promise<void> {
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
      case "ask_user_question_cancel": {
        const pending = this.pendingAskQuestions.get(resolution.requestId);
        if (!pending) return;
        this.pendingAskQuestions.delete(resolution.requestId);
        pending.resolve({
          behavior: "deny",
          message: "User dismissed the question.",
          interrupt: true,
        });
        return;
      }
      case "tool_approval": {
        const pending = this.pendingToolApprovals.get(resolution.requestId);
        if (!pending) return;
        this.pendingToolApprovals.delete(resolution.requestId);
        if (resolution.approved) {
          pending.resolve({
            behavior: "allow",
            updatedInput: pending.toolInput,
          });
        } else {
          const note = resolution.message?.trim();
          pending.resolve({
            behavior: "deny",
            message: note
              ? `The user rejected this tool call with the following feedback: "${note}". Address their feedback before retrying — do not ask them to repeat it.`
              : "User rejected the tool call.",
          });
        }
        return;
      }
      case "exit_plan_approval": {
        const pending = this.pendingExitPlanApprovals.get(resolution.requestId);
        if (!pending) return;
        this.pendingExitPlanApprovals.delete(resolution.requestId);
        if (resolution.approved) {
          // Just allow the tool through. The CLI's ExitPlanMode
          // handler picks the next permission mode on its own
          // (driven by the model-supplied `allowedPrompts` and the
          // CLI's post-approval defaults) — forcing a specific mode
          // from our side via `updatedPermissions` or
          // `setPermissionMode` would override whatever the CLI
          // decides, including valid edge cases like transitioning
          // to `default` when the plan needs approvals.
          //
          // We don't touch `this.userMode` here either. The
          // PostToolUse hook (wired alongside PreToolUse / Stop /
          // UserPromptSubmit) observes the CLI's new
          // `permission_mode` immediately after ExitPlanMode's
          // handler runs and emits `mode_changed` from ground truth.
          pending.resolve({
            behavior: "allow",
            updatedInput: pending.toolInput,
          });
        } else {
          const note = resolution.message?.trim();
          pending.resolve({
            behavior: "deny",
            message: note
              ? `The user rejected this plan with the following feedback: "${note}". Revise the plan to address their feedback — do not ask them what to change.`
              : "User rejected the proposed plan.",
          });
        }
        return;
      }
    }
  }

  /**
   * Flip the effective UserMode. If a query is live, push the mapped
   * `PermissionMode` into the SDK and wait for the ack before
   * committing local state — rejection (e.g. `bypassPermissions`
   * without `allowDangerouslySkipPermissions`) leaves `userMode`
   * untouched, so the UI never shows a mode the CLI never entered.
   * If no query is live, we just stash the new mode for the next
   * send(); the SDK will adopt it from the query options and the
   * init-message reconciliation (or the PreToolUse hook) will confirm.
   */
  async setMode(mode: UserMode, onEvent: (e: SessionEvent) => void): Promise<void> {
    if (this.userMode === mode) {
      // console.log(`[claude] setMode: no-op (already ${mode})`);
      return;
    }
    const q = this.queryInstance;
    const sdkFrom = CLAUDE_MODE[this.userMode];
    const sdkTo = CLAUDE_MODE[mode];
    // console.log(`[claude] setMode: ${this.userMode} → ${mode} (sdk ${sdkFrom}→${sdkTo}, liveQuery=${q !== null})`);

    // Update local state first — our `canUseTool` gate reads
    // `this.userMode` directly and is the sole authority for
    // ask/acceptEdits/bypass semantics. `pendingUserModeIntent`
    // prevents the reconcile hook from stomping this with a stale
    // SDK value before the SDK catches up.
    this.userMode = mode;
    this.pendingUserModeIntent = mode;
    onEvent({ kind: "mode_changed", mode });

    // Only call the SDK when the permission mode actually changes —
    // i.e. transitioning between plan and non-plan. Flips among
    // ask/acceptEdits/bypass are all within the SDK's "default" and
    // need no SDK round-trip; our gate handles them purely locally.
    if (q && sdkFrom !== sdkTo) {
      try {
        await q.setPermissionMode(sdkTo);
        // console.log(`[claude] setPermissionMode(${sdkTo}) acked by SDK`);
      } catch (err) {
        console.error(`[claude] setPermissionMode(${sdkTo}) FAILED (local userMode already updated):`, err);
      }
    }
  }

  /** Expose the derived UserMode for external observers (main process). */
  get currentUserMode(): UserMode {
    return this.userMode;
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
    for (const [, pending] of this.pendingExitPlanApprovals) {
      pending.resolve({
        behavior: "deny",
        message: "Session closed.",
        interrupt: true,
      });
    }
    this.pendingExitPlanApprovals.clear();
    for (const [, pending] of this.pendingToolApprovals) {
      pending.resolve({
        behavior: "deny",
        message: "Session closed.",
        interrupt: true,
      });
    }
    this.pendingToolApprovals.clear();
    try {
      this.queryInstance?.return(undefined);
    } catch {
      /* ignore */
    }
    this.queryInstance = null;
    this.streamLoopRunning = false;
  }

}
