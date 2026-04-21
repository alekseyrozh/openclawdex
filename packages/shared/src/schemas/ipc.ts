import { z } from "zod";

// ── Provider (which agent backend a thread is running against) ────

export const Provider = z.enum(["claude", "codex"]);
export type Provider = z.infer<typeof Provider>;

// ── UserMode (UI-level permission mode shared by both backends) ───

export const UserMode = z.enum(["plan", "ask", "acceptEdits", "bypassPermissions"]);
export type UserMode = z.infer<typeof UserMode>;

// ── Editor target (for the open-in-editor menu) ──────────────

export const EditorTarget = z.enum(["vscode", "cursor", "finder", "terminal", "iterm", "ghostty"]);
export type EditorTarget = z.infer<typeof EditorTarget>;

// ── Project types ─────────────────────────────────────────────

export const ProjectFolder = z.object({
  id: z.string(),
  path: z.string(),
});

export const ProjectInfo = z.object({
  id: z.string(),
  name: z.string(),
  folders: z.array(ProjectFolder),
  // Sidebar position. Optional on the wire so older payloads still parse;
  // undefined treated as "unsorted" (sorts last, stable).
  sortOrder: z.number().optional(),
});
export type ProjectInfo = z.infer<typeof ProjectInfo>;

// ── Context stats (persisted per session) ─────────────────────

// GOTCHA: costUsd and durationMs are optional because Codex's `turn.completed`
// event does not report a dollar cost (billing happens against the user's
// ChatGPT plan) and may not surface a duration. Renderers must null-check.
export const ContextStats = z.object({
  totalTokens: z.number().optional(),
  maxTokens: z.number().optional(),
  percentage: z.number().optional(),
  costUsd: z.number().optional(),
  durationMs: z.number().optional(),
});
export type ContextStats = z.infer<typeof ContextStats>;

// ── Session listing (invoke, not event) ───────────────────────

export const SessionInfo = z.object({
  sessionId: z.string(),
  provider: Provider,
  summary: z.string(),
  lastModified: z.number(),
  cwd: z.string().optional(),
  firstPrompt: z.string().optional(),
  gitBranch: z.string().optional(),
  projectId: z.string().optional(),
  contextStats: ContextStats.optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  // Epoch ms the thread was last archived. Drives the archive list
  // sort order (most-recent-first). Absent on rows that have never
  // been archived or that predate the column.
  archivedAt: z.number().optional(),
  userMode: UserMode.optional(),
  // Sidebar position within its bucket (pinned / per-project / orphan).
  // Lower sorts first; ties break on `lastModified` desc. Backfilled from
  // `createdAt` at migration time so existing threads keep their order.
  sortOrder: z.number().optional(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

export const HistoryImage = z.object({
  mediaType: z.string(),
  base64: z.string(),
});
export type HistoryImage = z.infer<typeof HistoryImage>;

// ── Image attachments on session:send (renderer → main) ──────
//
// Validated in main.ts before being handed to the agent backend.
// `path` is only set when Electron could resolve a real OS path for
// the attachment (drag-drop from the OS); clipboard pastes leave it
// undefined and we fall back to the inline `base64`.
export const ImagePayload = z.object({
  name: z.string(),
  base64: z.string(),
  mediaType: z.string(),
  path: z.string().optional(),
});
export type ImagePayload = z.infer<typeof ImagePayload>;

export const HistoryMessage = z.discriminatedUnion("role", [
  z.object({ id: z.string(), role: z.literal("user"), content: z.string(), images: z.array(HistoryImage).optional() }),
  z.object({ id: z.string(), role: z.literal("assistant"), content: z.string() }),
  z.object({ id: z.string(), role: z.literal("tool_use"), toolName: z.string(), toolInput: z.record(z.string(), z.unknown()).optional() }),
  z.object({ id: z.string(), role: z.literal("plan"), content: z.string(), planFilePath: z.string().optional() }),
]);
export type HistoryMessage = z.infer<typeof HistoryMessage>;

// ── Codex model listing ──────────────────────────────────────
//
// Mirrors the `Model` shape from the Codex app-server protocol
// (`model/list` RPC). Only the fields we currently use are required;
// the rest pass through so the schema doesn't have to chase every
// upstream addition. Run `codex app-server generate-json-schema
// --out <dir> --experimental` to inspect the full protocol.

export const CodexReasoningEffort = z.enum([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);
export type CodexReasoningEffort = z.infer<typeof CodexReasoningEffort>;

export const CodexReasoningEffortOption = z.object({
  reasoningEffort: CodexReasoningEffort,
  description: z.string(),
});

export const CodexModel = z.object({
  id: z.string(),
  model: z.string(),
  displayName: z.string(),
  description: z.string(),
  hidden: z.boolean(),
  isDefault: z.boolean(),
  // When non-null, OpenAI has marked this model as superseded by the
  // named successor (e.g. `upgrade: "gpt-5.4"`). We surface it in the
  // picker subtitle so users know they're about to pick a stale model.
  upgrade: z.string().nullable().optional(),
  defaultReasoningEffort: CodexReasoningEffort,
  supportedReasoningEfforts: z.array(CodexReasoningEffortOption),
});
export type CodexModel = z.infer<typeof CodexModel>;

// ── Claude model listing ─────────────────────────────────────
//
// Mirrors the `ModelInfo` shape returned by the Agent SDK's
// `Query.supportedModels()`. We pass through the boolean capability
// flags unchanged so the renderer can use them later without another
// schema change; only `supportedEffortLevels` is consumed today
// (to drive a per-model effort picker).

export const ClaudeEffortLevel = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type ClaudeEffortLevel = z.infer<typeof ClaudeEffortLevel>;

export const ClaudeModel = z.object({
  value: z.string(),
  displayName: z.string(),
  description: z.string(),
  supportsEffort: z.boolean().optional(),
  supportedEffortLevels: z.array(ClaudeEffortLevel).optional(),
  supportsAdaptiveThinking: z.boolean().optional(),
  supportsFastMode: z.boolean().optional(),
});
export type ClaudeModel = z.infer<typeof ClaudeModel>;

// ── AskUserQuestion tool input ───────────────────────────────

export const AskUserOption = z.object({
  label: z.string(),
  description: z.string(),
  preview: z.string().optional(),
});

export const AskUserQuestionItem = z.object({
  question: z.string(),
  header: z.string(),
  options: z.array(AskUserOption).min(2).max(4),
  multiSelect: z.boolean(),
});

export const AskUserInput = z.object({
  questions: z.array(AskUserQuestionItem).min(1).max(4),
});
export type AskUserInput = z.infer<typeof AskUserInput>;

// ── Thread CRUD inputs (renderer → main) ─────────────────────
//
// Validated in main.ts before touching the DB. The renderer is sandboxed
// and preload.ts annotates these as `string`/`boolean`, but the code
// rule ("Zod for all external data") treats any cross-process boundary
// as external — a compromised renderer or a future remote-control path
// shouldn't be able to send a non-string into `db.update`.

export const ThreadsRenameInput = z.tuple([z.string().min(1), z.string()]);
export const ThreadsPinInput = z.tuple([z.string().min(1), z.boolean()]);
export const ThreadsArchiveInput = z.tuple([z.string().min(1), z.boolean()]);
export const ThreadsDeleteInput = z.tuple([z.string().min(1)]);
export const ThreadsChangeProjectInput = z.tuple([
  z.string().min(1),
  z.string().min(1).nullable(),
]);
export const ThreadsSetModeInput = z.tuple([z.string().min(1), UserMode]);

// Ordered id list for sidebar drag-and-drop reorder. The handler writes
// each id's position back as its `sort_order`, so the passed array IS
// the authoritative order — clients must send the full list, not a
// delta. Empty is accepted (no-op) so the UI doesn't have to special-
// case an empty group.
export const ReorderInput = z.tuple([z.array(z.string().min(1))]);

// ── Events flowing from main process → renderer ──────────────

export const IpcAssistantText = z.object({
  type: z.literal("assistant_text"),
  threadId: z.string(),
  text: z.string(),
});

export const IpcStatus = z.object({
  type: z.literal("status"),
  threadId: z.string(),
  status: z.enum(["running", "idle", "error", "awaiting_input"]),
});

// GOTCHA: costUsd/durationMs optional because Codex doesn't report cost.
export const IpcResult = z.object({
  type: z.literal("result"),
  threadId: z.string(),
  costUsd: z.number().optional(),
  durationMs: z.number().optional(),
  totalTokens: z.number().optional(),
  maxTokens: z.number().optional(),
  percentage: z.number().optional(),
});

export const IpcError = z.object({
  type: z.literal("error"),
  threadId: z.string(),
  message: z.string(),
});

export const IpcSessionInit = z.object({
  type: z.literal("session_init"),
  threadId: z.string(),
  sessionId: z.string(),
  provider: Provider,
  model: z.string(),
  cwd: z.string().optional(),
  projectId: z.string().optional(),
});

// GOTCHA: when `toolUseId` is set, the renderer de-dupes on that id — if
// a message with the same id already exists, its content is replaced in
// place rather than a new card appended. Codex emits this on both
// `item.started` and `item.completed` for shell commands so the card
// appears immediately and fills in on completion. Claude emits each
// tool call once and can leave `toolUseId` unset.
export const IpcToolUse = z.object({
  type: z.literal("tool_use"),
  threadId: z.string(),
  toolUseId: z.string().optional(),
  toolName: z.string(),
  toolInput: z.record(z.string(), z.unknown()).optional(),
});

// ── Pending requests (agent pauses, waits for user) ──────────
//
// Generalizes "the agent needs something from the user before it can
// continue." Today only `ask_user_question` is emitted (by Claude via
// its AskUserQuestion tool); the discriminated union is shaped to
// accept approval-style variants (command approval, file-change
// approval, plan approval) without changing any surrounding plumbing.
//
// Protocol:
//   1. Agent emits a `pending_request` IPC event with a fresh `requestId`.
//   2. Renderer shows UI keyed on `kind`, collects user response.
//   3. Renderer dispatches `session:resolve-request` with a matching
//      `RequestResolution` variant (same `kind` + `requestId`).
//   4. Main routes the resolution to the session's `resolveRequest`.
//   5. Each backend translates the resolution into its native mechanism
//      (Claude: resolve the `canUseTool` Promise with `updatedInput`
//      carrying the answers; Codex: reply to the paused JSON-RPC
//      approval request — future).

export const PendingAskUserQuestion = z.object({
  kind: z.literal("ask_user_question"),
  requestId: z.string(),
  toolName: z.string(),
  input: z.record(z.string(), z.unknown()).optional(),
});

// Model called ExitPlanMode. The SDK tags this tool as `shouldDefer`,
// meaning the caller (us) must supply an approval signal before it
// runs. We intercept in `canUseTool` — the Promise returned there
// blocks the tool until `resolveRequest` fulfills it with an accept
// or reject. `plan` is the markdown the model proposed; renderer
// shows it in a PlanApprovalCard. `planFilePath` is optional because
// older / simpler plan-mode exits pass just `{plan: "..."}`.
export const PendingExitPlanApproval = z.object({
  kind: z.literal("exit_plan_approval"),
  requestId: z.string(),
  toolName: z.string(),
  plan: z.string(),
  planFilePath: z.string().optional(),
});

// Per-tool approval prompt. Fired in "ask" mode for mutating /
// shell-like tools, and in "acceptEdits" mode for shell-like tools
// only (edit-family tools auto-allow in acceptEdits). The renderer
// surfaces a `ToolApprovalCard` showing the tool name and a
// tool-specific input preview (diff for Edit, command for Bash,
// etc.), with Approve / Approve-for-session / Reject buttons.
export const PendingToolApproval = z.object({
  kind: z.literal("tool_approval"),
  requestId: z.string(),
  toolName: z.string(),
  toolInput: z.record(z.string(), z.unknown()),
});

export const PendingRequest = z.discriminatedUnion("kind", [
  PendingAskUserQuestion,
  PendingExitPlanApproval,
  PendingToolApproval,
]);
export type PendingRequest = z.infer<typeof PendingRequest>;

// `answers` is keyed by the question text (the `question` field of
// each AskUserQuestionItem) with values being the selected label, or a
// comma-joined string for multi-select questions. This matches the
// `AskUserQuestionOutput.answers` shape the Claude CLI's tool expects,
// so we can feed it straight back as the tool's `updatedInput` via the
// SDK's `canUseTool` callback. `displayText` is an opaque human-
// readable rendering of the same answers — used to render the user's
// reply bubble in chat, kept separate so the renderer owns its
// presentation.
export const AskUserQuestionResolution = z.object({
  kind: z.literal("ask_user_question"),
  requestId: z.string(),
  answers: z.record(z.string(), z.string()),
  displayText: z.string(),
});

// User dismissed the questionnaire (ESC / cancel). Backend denies the
// paused tool call so the agent unwinds cleanly instead of hanging.
export const AskUserQuestionCancelResolution = z.object({
  kind: z.literal("ask_user_question_cancel"),
  requestId: z.string(),
});

// User decision on an `exit_plan_approval` pending request. Fulfills
// the paused `canUseTool` Promise: on `approved: true` the ExitPlanMode
// tool runs (which flips the SDK off plan mode); on `false` we deny
// so the agent stays in plan mode and gets a clear message back. On
// reject, an optional `message` is forwarded to the agent as the deny
// reason so the user can steer plan revisions in one shot.
export const ExitPlanApprovalResolution = z.object({
  kind: z.literal("exit_plan_approval"),
  requestId: z.string(),
  approved: z.boolean(),
  message: z.string().optional(),
});

// User decision on a `tool_approval` pending request. Approve
// releases this single call; reject denies it. No session-memory —
// each call prompts independently. On reject, an optional `message`
// is forwarded to the agent as the deny reason so the user can steer
// the next step (e.g. "use rg instead of grep") without waiting for
// the tool to fail and replying after.
export const ToolApprovalResolution = z.object({
  kind: z.literal("tool_approval"),
  requestId: z.string(),
  approved: z.boolean(),
  message: z.string().optional(),
});

export const RequestResolution = z.discriminatedUnion("kind", [
  AskUserQuestionResolution,
  AskUserQuestionCancelResolution,
  ExitPlanApprovalResolution,
  ToolApprovalResolution,
]);
export type RequestResolution = z.infer<typeof RequestResolution>;

export const IpcPendingRequest = z.object({
  type: z.literal("pending_request"),
  threadId: z.string(),
  request: PendingRequest,
});

// Mode change — fires both when the user flips the dropdown (IPC
// round-trip) and when the model calls EnterPlanMode/ExitPlanMode on
// its own. The renderer treats this as the authoritative reconciliation
// path for `thread.userMode`.
export const IpcModeChanged = z.object({
  type: z.literal("mode_changed"),
  threadId: z.string(),
  mode: UserMode,
});

// A `<proposed_plan>` block the backend extracted from an assistant
// message when no approval is wanted (e.g. Codex outside plan mode —
// the tag is a rendering hint, not a gate, so we just append a plan
// card to the transcript). In plan mode we use `pending_request` with
// `exit_plan_approval` instead so the user can approve/reject.
export const IpcPlanCard = z.object({
  type: z.literal("plan_card"),
  threadId: z.string(),
  plan: z.string(),
});

export const IpcEvent = z.discriminatedUnion("type", [
  IpcAssistantText,
  IpcStatus,
  IpcResult,
  IpcError,
  IpcSessionInit,
  IpcToolUse,
  IpcPendingRequest,
  IpcModeChanged,
  IpcPlanCard,
]);
export type IpcEvent = z.infer<typeof IpcEvent>;
