import fs from "fs";
import os from "os";
import path from "path";
import { z } from "zod";
import type { UserMode } from "@openclawdex/shared";
import { codexTurnContextToUserMode } from "./user-mode";
import { extractProposedPlans } from "./codex-plan";
import { codexDisplayCommand } from "./command-display";

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
const InputImageItem = z.object({ type: z.literal("input_image"), image_url: z.string() });

const MessagePayload = z.object({
  type: z.literal("message"),
  role: z.enum(["user", "assistant", "developer", "system"]),
  content: z.array(
    z.union([
      InputTextItem,
      OutputTextItem,
      InputImageItem,
      z.object({ type: z.string() }).passthrough(),
    ]),
  ),
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
  | {
      id: string;
      role: "user";
      content: string;
      images?: Array<{ mediaType: string; base64: string }>;
    }
  | { id: string; role: "assistant"; content: string }
  | { id: string; role: "tool_use"; toolName: string; toolInput?: Record<string, unknown> }
  | { id: string; role: "plan"; content: string };

function parseDataUrlImage(
  value: string,
): { mediaType: string; base64: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value);
  if (!match) return null;
  return { mediaType: match[1], base64: match[2] };
}

function isImagePlaceholderText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === "<image>" || /^<image\b[^>]*>\s*<\/image>$/.test(trimmed);
}

function stripImagePlaceholderTags(text: string): string {
  return text.replace(/<\/?image\b[^>]*>/g, "");
}

function normalizeToolCall(
  name: string,
  args?: Record<string, unknown>,
): { toolName: string; toolInput?: Record<string, unknown> } | null {
  switch (name) {
    case "exec_command":
      return {
        toolName: "shell",
        toolInput: {
          ...(args ?? {}),
          ...(typeof args?.cmd === "string" ? { command: args.cmd } : {}),
          ...(typeof args?.cmd === "string"
            ? (() => {
                const displayCommand = codexDisplayCommand(args.cmd);
                return displayCommand ? { display_command: displayCommand } : {};
              })()
            : {}),
        },
      };
    case "shell_command": {
      const command = typeof args?.command === "string" ? args.command : undefined;
      const displayCommand = command ? codexDisplayCommand(command) : undefined;
      return {
        toolName: "shell",
        toolInput: {
          ...(args ?? {}),
          ...(displayCommand ? { display_command: displayCommand } : {}),
        },
      };
    }
    case "request_user_input":
      return {
        toolName: "AskUserQuestion",
        toolInput: args,
      };
    case "write_stdin":
      // `write_stdin` is an implementation detail of an already-open
      // shell session. The live Codex session path doesn't render it as
      // a separate tool card, so hide it from replayed history too.
      return null;
    default:
      return { toolName: name, ...(args && { toolInput: args }) };
  }
}

/**
 * Locate the rollout JSONL for a thread id. The file name always ends
 * with `<threadId>.jsonl`, so we walk YYYY/MM/DD dirs and match by
 * suffix rather than guessing the timestamp prefix.
 *
 * PERFORMANCE NOTE: calling this in a loop (e.g. once per sidebar row)
 * is O(N·M) where M is the total number of rollout files on disk. Use
 * {@link buildCodexSessionIndex} to do one walk and look up by id.
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

/**
 * Walk `~/.codex/sessions/**` once and return a `Map<threadId, filePath>`.
 *
 * Use this when you need to look up multiple thread ids in one pass (e.g.
 * building the sidebar from many `known_threads` rows). A single walk is
 * fast even with hundreds of rollouts; repeated `findCodexSessionFile`
 * calls are not.
 *
 * Rollout filenames follow `rollout-<ISO-ts>-<uuid>.jsonl` where both
 * the timestamp and the UUID contain `-`, so we extract the trailing
 * UUID via a shape-based regex rather than string splitting.
 */
const UUID_TAIL = /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.jsonl$/;

export function buildCodexSessionIndex(): Map<string, string> {
  const index = new Map<string, string>();
  if (!fs.existsSync(SESSIONS_ROOT)) return index;

  for (const year of safeReaddir(SESSIONS_ROOT)) {
    const yearDir = path.join(SESSIONS_ROOT, year);
    for (const month of safeReaddir(yearDir)) {
      const monthDir = path.join(yearDir, month);
      for (const day of safeReaddir(monthDir)) {
        const dayDir = path.join(monthDir, day);
        for (const file of safeReaddir(dayDir)) {
          const match = UUID_TAIL.exec(file);
          if (!match) continue;
          index.set(match[1], path.join(dayDir, file));
        }
      }
    }
  }
  return index;
}

/**
 * Cached wrapper around {@link buildCodexSessionIndex}.
 *
 * `session:load-history` is called once per thread-open and the naive
 * implementation re-walks `~/.codex/sessions/**` on every call — with
 * hundreds of rollouts that adds up. The cache is held forever and
 * invalidated in two places:
 *
 *   1. main.ts calls {@link invalidateCodexSessionIndex} on every
 *      `init` event, because that's when a brand-new rollout file
 *      appears on disk for a thread we just started.
 *   2. {@link readCodexHistory} invalidates on a cache miss before
 *      retrying, so Codex sessions started outside this app (e.g.
 *      from a terminal `codex` invocation) are picked up too.
 */
let cachedIndex: Map<string, string> | null = null;

export function getCodexSessionIndex(): Map<string, string> {
  if (!cachedIndex) cachedIndex = buildCodexSessionIndex();
  return cachedIndex;
}

export function invalidateCodexSessionIndex(): void {
  cachedIndex = null;
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
  // Use the cached index — `session:load-history` fires once per
  // thread-open, and without a cache each call re-walks the entire
  // `~/.codex/sessions` tree. If the id isn't in the cache we fall
  // back to a fresh walk once in case the rollout landed after the
  // last cache refresh.
  let file = getCodexSessionIndex().get(threadId) ?? null;
  if (!file) {
    invalidateCodexSessionIndex();
    file = getCodexSessionIndex().get(threadId) ?? null;
  }
  if (!file) return [];
  return readCodexHistoryFromFile(file);
}

/**
 * Same as {@link readCodexHistory} but takes a pre-resolved file path.
 * Callers that already looked the path up via {@link buildCodexSessionIndex}
 * should use this to avoid re-walking the sessions tree.
 */
export function readCodexHistoryFromFile(file: string): CodexHistoryMsg[] {
  const result: CodexHistoryMsg[] = [];
  let itemIdx = 0;

  let content: string;
  try { content = fs.readFileSync(file, "utf-8"); } catch { return []; }
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

      const images =
        msg.role === "user"
          ? msg.content
              .flatMap((b) => {
                if (b.type !== "input_image") return [];
                const parsedImage = parseDataUrlImage(
                  (b as z.infer<typeof InputImageItem>).image_url,
                );
                return parsedImage ? [parsedImage] : [];
              })
          : [];

      const text = msg.content
        .flatMap((b) => {
          if (b.type === "input_text") {
            const rawValue = (b as z.infer<typeof InputTextItem>).text;
            if (images.length > 0) {
              if (isImagePlaceholderText(rawValue)) return [];
              const cleaned = stripImagePlaceholderTags(rawValue);
              if (!cleaned) return [];
              return [cleaned];
            }
            return [rawValue];
          }
          if (b.type === "output_text") return [(b as z.infer<typeof OutputTextItem>).text];
          return [];
        })
        .join("");
      if (!text.trim() && images.length === 0) continue;
      if (msg.role === "user" && isInjectedContext(text)) continue;

      if (msg.role === "assistant") {
        // Pull any `<proposed_plan>` blocks out into their own history
        // items so the renderer can show them as plan cards instead of
        // leaking the XML tags into the transcript. Mirrors how the
        // live stream surfaces `item.type === "plan"` as a distinct
        // event — see codex.ts and t3code's CodexAdapter.
        const { clean, plans } = extractProposedPlans(text);
        if (clean.length > 0) {
          result.push({ id: `codex-${itemIdx++}`, role: "assistant", content: clean });
        }
        for (const plan of plans) {
          result.push({ id: `codex-${itemIdx++}`, role: "plan", content: plan });
        }
        continue;
      }

      result.push({
        id: `codex-${itemIdx++}`,
        role: msg.role,
        content: text,
        ...(msg.role === "user" && images.length > 0 ? { images } : {}),
      });
    } else if (payload.type === "function_call") {
      const call = payload as z.infer<typeof FunctionCallPayload>;
      let args: Record<string, unknown> | undefined;
      try {
        const parsedArgs: unknown = JSON.parse(call.arguments);
        if (parsedArgs && typeof parsedArgs === "object") {
          args = parsedArgs as Record<string, unknown>;
        }
      } catch { /* keep args undefined */ }
      const normalized = normalizeToolCall(call.name, args);
      if (!normalized) continue;
      result.push({ id: `codex-${itemIdx++}`, role: "tool_use", ...normalized });
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
  return summaryFromHistory(history);
}

/**
 * Same as {@link readCodexSummary} but takes a pre-resolved file path.
 * Prefer this when iterating many threads — pair it with
 * {@link buildCodexSessionIndex} for a single tree walk.
 */
export function readCodexSummaryFromFile(file: string): string | null {
  return summaryFromHistory(readCodexHistoryFromFile(file));
}

/**
 * Scan the rollout for the most recent `turn_context` entry and derive
 * the UserMode the thread was last running under. Returns `null` if
 * the file has no `turn_context` entries — callers fall back to
 * defaults.
 *
 * Codex logs a fresh `turn_context` at the start of every turn with
 * the exact `approval_policy` + `sandbox_policy` the server used, so
 * the last one tells us the current effective mode.
 */
export function readCodexUserModeFromFile(file: string): UserMode | null {
  let content: string;
  try { content = fs.readFileSync(file, "utf-8"); } catch { return null; }
  let last: UserMode | null = null;
  for (const line of content.split("\n")) {
    if (!line) continue;
    // Cheap prefilter — full JSON.parse on every line is wasteful.
    if (!line.includes('"turn_context"')) continue;
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { continue; }
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as {
      type?: string;
      payload?: {
        approval_policy?: unknown;
        sandbox_policy?: { type?: unknown };
        collaboration_mode?: { mode?: unknown };
      };
    };
    if (entry.type !== "turn_context" || !entry.payload) continue;
    const approval = typeof entry.payload.approval_policy === "string" ? entry.payload.approval_policy : undefined;
    const sandboxType = typeof entry.payload.sandbox_policy?.type === "string" ? entry.payload.sandbox_policy.type : undefined;
    const collaborationMode = typeof entry.payload.collaboration_mode?.mode === "string" ? entry.payload.collaboration_mode.mode : undefined;
    last = codexTurnContextToUserMode(approval, sandboxType, collaborationMode);
  }
  return last;
}

function summaryFromHistory(history: CodexHistoryMsg[]): string | null {
  const firstUser = history.find((m) => m.role === "user");
  if (!firstUser) return null;
  const oneLine = firstUser.content.trim().split("\n")[0];
  return oneLine.length > 60 ? oneLine.slice(0, 60) + "…" : oneLine;
}
