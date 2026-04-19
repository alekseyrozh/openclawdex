import fs from "fs";
import os from "os";
import path from "path";
import type { UserMode } from "@openclawdex/shared";
import { claudePermissionModeToUserMode } from "./user-mode";

/**
 * Read UserMode state from Claude's on-disk rollout files.
 *
 * Claude stores rollouts as JSONL at
 *   ~/.claude/projects/<cwd-slug>/<sessionId>.jsonl
 * where `<cwd-slug>` is the cwd with `/` replaced by `-` (prepended
 * with a leading `-`). Each `user` entry in the file carries a
 * `permissionMode` field inline, so the last such value is the
 * thread's current effective mode.
 *
 * The SDK's `listSessions()` doesn't surface this, so we parse
 * directly. Performance: walking the whole `~/.claude/projects` tree
 * once is ~O(N) in the number of rollout files, same as Codex.
 */

const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");

function safeReaddir(p: string): string[] {
  try { return fs.readdirSync(p); } catch { return []; }
}

/**
 * One walk of `~/.claude/projects/**` returning `Map<sessionId, filePath>`.
 * Mirrors the Codex index — use this when looking up multiple session
 * ids in one pass so we don't walk the tree repeatedly.
 */
export function buildClaudeSessionIndex(): Map<string, string> {
  const index = new Map<string, string>();
  if (!fs.existsSync(PROJECTS_ROOT)) return index;
  for (const projectDir of safeReaddir(PROJECTS_ROOT)) {
    const full = path.join(PROJECTS_ROOT, projectDir);
    for (const file of safeReaddir(full)) {
      if (!file.endsWith(".jsonl")) continue;
      const id = file.slice(0, -".jsonl".length);
      index.set(id, path.join(full, file));
    }
  }
  return index;
}

let cachedIndex: Map<string, string> | null = null;

export function getClaudeSessionIndex(): Map<string, string> {
  if (!cachedIndex) cachedIndex = buildClaudeSessionIndex();
  return cachedIndex;
}

export function invalidateClaudeSessionIndex(): void {
  cachedIndex = null;
}

/**
 * Scan a rollout for the most recent `permissionMode` value recorded
 * on a `user` entry, and map it to the UI's {@link UserMode}. Returns
 * `null` if the file has no such entries (brand-new session that
 * hasn't logged anything yet).
 */
export function readClaudeUserModeFromFile(file: string): UserMode | null {
  let content: string;
  try { content = fs.readFileSync(file, "utf-8"); } catch { return null; }
  let last: UserMode | null = null;
  for (const line of content.split("\n")) {
    if (!line) continue;
    if (!line.includes('"permissionMode"')) continue;
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { continue; }
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as { permissionMode?: unknown };
    if (typeof entry.permissionMode === "string") {
      last = claudePermissionModeToUserMode(entry.permissionMode);
    }
  }
  return last;
}

/**
 * Look up the rollout for a session id (uses the cached index) and
 * return its last-recorded UserMode, or `null` if not found.
 */
export function readClaudeUserMode(sessionId: string): UserMode | null {
  let file = getClaudeSessionIndex().get(sessionId) ?? null;
  if (!file) {
    invalidateClaudeSessionIndex();
    file = getClaudeSessionIndex().get(sessionId) ?? null;
  }
  if (!file) return null;
  return readClaudeUserModeFromFile(file);
}
