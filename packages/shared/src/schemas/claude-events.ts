import { z } from "zod";

// ── Content blocks inside assistant messages ──────────────────

export const TextBlock = z.object({
  type: z.literal("text"),
  text: z.string(),
});
export type TextBlock = z.infer<typeof TextBlock>;

export const ToolUseBlock = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});
export type ToolUseBlock = z.infer<typeof ToolUseBlock>;

export const ContentBlock = z.discriminatedUnion("type", [
  TextBlock,
  ToolUseBlock,
]);
export type ContentBlock = z.infer<typeof ContentBlock>;

// ── Individual stream-json event types ────────────────────────

export const SystemInitEvent = z.object({
  type: z.literal("system"),
  subtype: z.literal("init"),
  session_id: z.string(),
  model: z.string(),
  cwd: z.string(),
  tools: z.array(z.string()),
});
export type SystemInitEvent = z.infer<typeof SystemInitEvent>;

export const AssistantEvent = z.object({
  type: z.literal("assistant"),
  session_id: z.string(),
  message: z.object({
    id: z.string(),
    role: z.literal("assistant"),
    content: z.array(ContentBlock),
    model: z.string(),
  }),
});
export type AssistantEvent = z.infer<typeof AssistantEvent>;

export const ResultEvent = z.object({
  type: z.literal("result"),
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string(),
  session_id: z.string(),
  total_cost_usd: z.number(),
  duration_ms: z.number(),
  num_turns: z.number(),
});
export type ResultEvent = z.infer<typeof ResultEvent>;

// ── Minimal base schema for triage ────────────────────────────

/** Parse just the `type` field so we can route to the right schema. */
export const BaseStreamEvent = z.object({
  type: z.string(),
});
