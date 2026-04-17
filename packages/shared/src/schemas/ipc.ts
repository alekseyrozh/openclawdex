import { z } from "zod";

// ── Provider (which agent backend a thread is running against) ────

export const Provider = z.enum(["claude", "codex"]);
export type Provider = z.infer<typeof Provider>;

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
});
export type SessionInfo = z.infer<typeof SessionInfo>;

export const HistoryImage = z.object({
  mediaType: z.string(),
  base64: z.string(),
});
export type HistoryImage = z.infer<typeof HistoryImage>;

export const HistoryMessage = z.discriminatedUnion("role", [
  z.object({ id: z.string(), role: z.literal("user"), content: z.string(), images: z.array(HistoryImage).optional() }),
  z.object({ id: z.string(), role: z.literal("assistant"), content: z.string() }),
  z.object({ id: z.string(), role: z.literal("tool_use"), toolName: z.string(), toolInput: z.record(z.string(), z.unknown()).optional() }),
]);
export type HistoryMessage = z.infer<typeof HistoryMessage>;

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

export const IpcToolUse = z.object({
  type: z.literal("tool_use"),
  threadId: z.string(),
  toolName: z.string(),
  toolInput: z.record(z.string(), z.unknown()).optional(),
});

// GOTCHA: Codex has no equivalent of Claude's AskUserQuestion pause-for-input
// protocol, so deferred_tool_use events are emitted only for Claude threads.
export const IpcDeferredToolUse = z.object({
  type: z.literal("deferred_tool_use"),
  threadId: z.string(),
  toolUseId: z.string(),
  toolName: z.string(),
  toolInput: z.record(z.string(), z.unknown()).optional(),
});

export const IpcEvent = z.discriminatedUnion("type", [
  IpcAssistantText,
  IpcStatus,
  IpcResult,
  IpcError,
  IpcSessionInit,
  IpcToolUse,
  IpcDeferredToolUse,
]);
export type IpcEvent = z.infer<typeof IpcEvent>;
