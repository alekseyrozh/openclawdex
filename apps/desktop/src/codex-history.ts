import fs from "fs";
import os from "os";
import path from "path";
import { z } from "zod";

/**
 * Read Codex thread state from the CLI's on-disk rollout files.
 *
 * The Codex SDK (0.121.0) does NOT expose a way to list historical
 * thread items, so we parse the JSONL rollouts directly:
 *
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<threadId>.jsonl
 *
 * This is the same file `codex resume` reads, so resume semantics
 * are unchanged — we just mirror what the CLI has on disk so the
 * UI can display the transcript after a refresh.
 */

const SESSIONS_ROOT = path.join(os.homedir(), ".codex", "sessions");

const InputTextItem = z.object({ type: z.literal("input_text"), text: z.string() });
const OutputTextItem = z.object({ type: z.literal("output_text"), text: z.string() });

const MessagePayload = z.object({
  type: z.literal("message"),
  role: z.enum(["user", "assistant", "developer", "system"]),
  content: z.array(z.union([InputTextItem, OutputTextItem, z.object({ type: z.string() }).passthrough()])),
});

const FunctionCallPayload = z.object({
  type: z.literal("function_call"),
  name: z.string(),
  arguments: z.string(),
  call_id: z.string().optional(),
});

const ResponseItemLine = z.object({
  type: z.literal("response_item"),
  payload: z.union([MessagePayload, FunctionCallPayload, z.object({ type: z.string() }).passthrough()]),
});

export type CodexHistoryMsg =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string }
  | { id: string; role: "tool_use"; toolName: string; toolInput?: Record<string, unknown> };

/**
 * Locate the rollout JSONL for a thread id. The file name always ends
 * with `<threadId>.jsonl`, so we walk YYYY/MM/DD dirs and match by
 * suffix rather than guessing the timestamp prefix.
 */
export function findCodexSessionFile(threadId: string): string | null {
  const suffix = `${threadId}.jsonl`;
  if (!fs.existsSync(SESSIONS_ROOT)) return null;

  for (const year of safeReaddir(SESSIONS_ROOT)) {
    const yearDir = path.join(SESSIONS_ROOT, year);
    for (const month of safeReaddir(yearDir)) {
      const monthDir = path.join(yearDir, month);
      for (const day of safeReaddir(monthDir)) {
        const dayDir = path.join(monthDir, day);
        for (const file of safeReaddir(dayDir)) {
          if (file.endsWith(suffix)) return path.join(dayDir, file);
        }
      }
    }
  }
  return null;
}

function safeReaddir(p: string): string[] {
  try { return fs.readdirSync(p); } catch { return []; }
}

/**
 * User messages the Codex CLI injects for context (environment,
 * permissions, collaboration mode, skills) are wrapped in XML-ish
 * tags. They aren't real user input and shouldn't clutter the UI.
 */
function isInjectedContext(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("<environment_context")
    || trimmed.startsWith("<permissions")
    || trimmed.startsWith("<collaboration_mode")
    || trimmed.startsWith("<skills_instructions")
    || trimmed.startsWith("<user_instructions")
    || trimmed.startsWith("<INSTRUCTIONS")
    || trimmed.startsWith("# AGENTS.md instructions");
}

/** Parse the rollout file into provider-neutral history messages. */
export function readCodexHistory(threadId: string): CodexHistoryMsg[] {
  const file = findCodexSessionFile(threadId);
  if (!file) return [];

  const result: CodexHistoryMsg[] = [];
  let itemIdx = 0;

  const content = fs.readFileSync(file, "utf-8");
  for (const line of content.split("\n")) {
    if (!line) continue;
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { continue; }

    const parsed = ResponseItemLine.safeParse(raw);
    if (!parsed.success) continue;
    const payload = parsed.data.payload;

    if (payload.type === "message") {
      const msg = payload as z.infer<typeof MessagePayload>;
      if (msg.role !== "user" && msg.role !== "assistant") continue;

      const text = msg.content
        .flatMap((b) => {
          if (b.type === "input_text") return [(b as z.infer<typeof InputTextItem>).text];
          if (b.type === "output_text") return [(b as z.infer<typeof OutputTextItem>).text];
          return [];
        })
        .join("");
      if (!text.trim()) continue;
      if (msg.role === "user" && isInjectedContext(text)) continue;

      result.push({ id: `codex-${itemIdx++}`, role: msg.role, content: text });
    } else if (payload.type === "function_call") {
      const call = payload as z.infer<typeof FunctionCallPayload>;
      let args: Record<string, unknown> | undefined;
      try {
        const parsedArgs: unknown = JSON.parse(call.arguments);
        if (parsedArgs && typeof parsedArgs === "object") {
          args = parsedArgs as Record<string, unknown>;
        }
      } catch { /* keep args undefined */ }
      result.push({
        id: `codex-${itemIdx++}`,
        role: "tool_use",
        toolName: call.name,
        ...(args && { toolInput: args }),
      });
    }
  }

  return result;
}

/**
 * Derive a summary (first real user prompt) for the sidebar label.
 * Falls back to null if the rollout file is missing or only contains
 * injected-context messages.
 */
export function readCodexSummary(threadId: string): string | null {
  const history = readCodexHistory(threadId);
  const firstUser = history.find((m) => m.role === "user");
  if (!firstUser) return null;
  const oneLine = firstUser.content.trim().split("\n")[0];
  return oneLine.length > 60 ? oneLine.slice(0, 60) + "…" : oneLine;
}
