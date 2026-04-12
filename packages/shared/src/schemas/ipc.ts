import { z } from "zod";

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
});

export const IpcEvent = z.discriminatedUnion("type", [
  IpcAssistantText,
  IpcStatus,
  IpcResult,
  IpcError,
  IpcSessionInit,
]);
export type IpcEvent = z.infer<typeof IpcEvent>;
