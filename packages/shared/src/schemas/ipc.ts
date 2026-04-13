import { z } from "zod";

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

// ── Session listing (invoke, not event) ───────────────────────

export const SessionInfo = z.object({
  sessionId: z.string(),
  summary: z.string(),
  lastModified: z.number(),
  cwd: z.string().optional(),
  firstPrompt: z.string().optional(),
  gitBranch: z.string().optional(),
  projectId: z.string().optional(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

export const HistoryMessage = z.discriminatedUnion("role", [
  z.object({ id: z.string(), role: z.literal("user"), content: z.string() }),
  z.object({ id: z.string(), role: z.literal("assistant"), content: z.string() }),
  z.object({ id: z.string(), role: z.literal("tool_use"), toolName: z.string() }),
]);
export type HistoryMessage = z.infer<typeof HistoryMessage>;

// ── Events flowing from main process → renderer ──────────────

export const IpcAssistantText = z.object({
  type: z.literal("assistant_text"),
  threadId: z.string(),
  text: z.string(),
});

export const IpcStatus = z.object({
  type: z.literal("status"),
  threadId: z.string(),
  status: z.enum(["running", "idle", "error"]),
});

export const IpcResult = z.object({
  type: z.literal("result"),
  threadId: z.string(),
  costUsd: z.number(),
  durationMs: z.number(),
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
  model: z.string(),
  cwd: z.string().optional(),
  projectId: z.string().optional(),
});

export const IpcToolUse = z.object({
  type: z.literal("tool_use"),
  threadId: z.string(),
  toolName: z.string(),
});

export const IpcEvent = z.discriminatedUnion("type", [
  IpcAssistantText,
  IpcStatus,
  IpcResult,
  IpcError,
  IpcSessionInit,
  IpcToolUse,
]);
export type IpcEvent = z.infer<typeof IpcEvent>;
