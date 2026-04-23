import { app, BrowserWindow, ipcMain, nativeTheme, dialog } from "electron";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;
import { shell } from "electron";
import path from "path";
import { randomUUID } from "crypto";
import { execSync, spawn } from "child_process";
import fs from "fs";
import { eq, asc } from "drizzle-orm";
import { findClaudeBinary, ClaudeSession } from "./claude";
import { isCodexInstalled, CodexSession } from "./codex";
import {
  readCodexHistory,
  readCodexSummaryFromFile,
  buildCodexSessionIndex,
  invalidateCodexSessionIndex,
  readCodexUserModeFromFile,
} from "./codex-history";
import {
  buildClaudeSessionIndex,
  invalidateClaudeSessionIndex,
  readClaudeUserModeFromFile,
} from "./claude-history";
import { listCodexModels } from "./codex-models";
import { listClaudeModels } from "./claude-models";
import type { AgentSession } from "./agent-session";
import {
  listSessions,
  getSessionMessages,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type {
  IpcEvent,
  EditorTarget,
  Provider,
  SessionInfo,
  CodexReasoningEffort,
  ClaudeEffortLevel,
  UserMode,
  ImagePayload as ImagePayloadT,
} from "@openclawdex/shared";
import { ImagePayload, RequestResolution } from "@openclawdex/shared";
import { ContextStats } from "@openclawdex/shared";
import {
  ThreadsRenameInput,
  ThreadsPinInput,
  ThreadsArchiveInput,
  ThreadsDeleteInput,
  ThreadsChangeProjectInput,
  ThreadsSetModeInput,
  ReorderInput,
  ThreadsReorderInput,
} from "@openclawdex/shared";
import { initDb, getDb } from "./db";
import { knownThreads, projects, projectFolders } from "./db/schema";

const DEV_URL = "http://localhost:4123";
const IS_DEV = !app.isPackaged;

// macOS GUI apps don't inherit the shell PATH. Load it so child processes
// (Claude CLI, git, node, etc.) work the same as in the terminal.
if (app.isPackaged && process.platform === "darwin") {
  try {
    const path = execSync("/bin/zsh -ilc 'echo $PATH'", {
      encoding: "utf-8",
    }).trim();
    if (path) process.env.PATH = path;
  } catch {
    /* keep default PATH */
  }
}

let mainWindow: BrowserWindow | null = null;

// ── Agent state ───────────────────────────────────────────────
//
// Both Claude and Codex sessions share one map keyed by threadId, typed
// as the provider-neutral AgentSession. The handler looks up the thread's
// `provider` column to decide which backend to instantiate on first send.

const claudePath = findClaudeBinary();
const codexInstalled = isCodexInstalled();
const sessions = new Map<string, AgentSession>();

// UserMode overrides set via `threads:set-mode` while no live session
// exists yet (e.g. user flips the dropdown before sending the next
// turn). Consumed by `getOrCreateSession` on the next construction and
// cleared once the session is live — the CLI's rollout file takes over
// as the persistence surface from that point on.
const pendingModeOverrides = new Map<string, UserMode>();

function getOrCreateSession(
  threadId: string,
  provider: Provider,
  opts?: {
    resumeSessionId?: string;
    cwd?: string;
    model?: string;
    // GOTCHA: `effort` is typed as a string here because Claude and Codex
    // use incompatible effort vocabularies. We pass it through verbatim
    // and let each SDK reject it if invalid. Renderer enforces the right
    // list per provider in the model picker UI.
    effort?: string;
    userMode?: UserMode;
  },
): AgentSession | null {
  const existing = sessions.get(threadId);
  if (existing) return existing;

  // Resolve initial mode: explicit opts > pending override > last
  // rollout entry > "acceptEdits".
  const override = pendingModeOverrides.get(threadId);
  pendingModeOverrides.delete(threadId);
  let userMode: UserMode = opts?.userMode ?? override ?? "acceptEdits";
  if (!opts?.userMode && override === undefined && opts?.resumeSessionId) {
    const fromRollout =
      provider === "claude"
        ? readClaudeUserModeFromFile(findClaudeRolloutFile(opts.resumeSessionId) ?? "")
        : readCodexUserModeFromRolloutId(opts.resumeSessionId);
    if (fromRollout) userMode = fromRollout;
  }

  if (provider === "claude") {
    if (!claudePath) return null;
    const session = new ClaudeSession(claudePath, {
      resumeSessionId: opts?.resumeSessionId,
      cwd: opts?.cwd,
      model: opts?.model,
      effort: opts?.effort as ClaudeEffortLevel | undefined,
      userMode,
    });
    sessions.set(threadId, session);
    return session;
  }

  // provider === "codex"
  if (!codexInstalled) return null;
  const session = new CodexSession({
    resumeThreadId: opts?.resumeSessionId,
    cwd: opts?.cwd,
    model: opts?.model,
    effort: opts?.effort as CodexReasoningEffort | undefined,
    userMode,
  });
  sessions.set(threadId, session);
  return session;
}

// Helpers kept file-local because they only exist to bridge the two
// history readers into `getOrCreateSession` — neither the renderer nor
// the session constructors need them.
function findClaudeRolloutFile(sessionId: string): string | null {
  return buildClaudeSessionIndex().get(sessionId) ?? null;
}
function readCodexUserModeFromRolloutId(sessionId: string): UserMode | null {
  const file = buildCodexSessionIndex().get(sessionId);
  return file ? readCodexUserModeFromFile(file) : null;
}

/**
 * Last status emitted per thread. Used to suppress redundant `status`
 * events — the Codex wrapper in particular emits both `result` and
 * `done` at the end of each turn, which naively translate to *two*
 * `status: idle` events in quick succession. That's harmless for most
 * consumers, but the renderer's message queue treats each `idle` as a
 * drain trigger, so back-to-back idles pop two queued messages for a
 * single turn boundary. Dedup here keeps the emission semantics clean
 * (one `idle` per turn end, regardless of provider event shape).
 */
const lastEmittedStatus = new Map<string, "running" | "idle" | "awaiting_input" | "error">();

/** Send a validated IPC event to the renderer. */
function emitToRenderer(event: IpcEvent): void {
  // Drop no-op status transitions. Any non-status event is forwarded
  // as-is; only `status` is deduped because it's the one field that
  // multiple session-event sources converge on.
  if (event.type === "status") {
    const prev = lastEmittedStatus.get(event.threadId);
    if (prev === event.status) return;
    lastEmittedStatus.set(event.threadId, event.status);
  }
  mainWindow?.webContents.send("session:event", event);
}

/**
 * Parse a `known_threads.context_stats` TEXT column into a validated
 * ContextStats object, or `undefined` on any failure (null column,
 * malformed JSON, schema mismatch).
 *
 * The column is external data written by previous runs of this app —
 * possibly a different version with a different schema — so we validate
 * with Zod rather than trusting the JSON shape (per the project's "Zod
 * for all external data" rule).
 */
function parseContextStats(raw: string | null): ContextStats | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const result = ContextStats.safeParse(parsed);
  return result.success ? result.data : undefined;
}

/**
 * Resolve which agent backend a send should route to.
 *
 * Ordering, in decreasing authority:
 *   1. The `known_threads.provider` column for `resumeSessionId`, if we
 *      have a row for it. This is the committed, authoritative value —
 *      a thread that was started against Codex must always resume
 *      against Codex, regardless of what the renderer currently thinks.
 *   2. The renderer-supplied `providerHint`. Used for the very first
 *      turn of a brand-new thread, before a DB row exists.
 *   3. `"claude"` as a last-resort default (preserves pre-multi-provider
 *      behavior for callers that omit the field).
 */
async function resolveProvider(
  resumeSessionId: string | undefined,
  providerHint: Provider | undefined,
): Promise<Provider> {
  if (resumeSessionId) {
    const rows = await getDb()
      .select({ provider: knownThreads.provider })
      .from(knownThreads)
      .where(eq(knownThreads.sessionId, resumeSessionId))
      .limit(1);
    const persisted = rows[0]?.provider;
    if (persisted === "claude" || persisted === "codex") return persisted;
  }
  return providerHint ?? "claude";
}

/** Resolve the first folder path for a project, or undefined. */
async function getProjectCwd(projectId: string): Promise<string | undefined> {
  const rows = await getDb()
    .select({ folderPath: projectFolders.folderPath })
    .from(projectFolders)
    .where(eq(projectFolders.projectId, projectId))
    .limit(1);
  return rows[0]?.folderPath;
}

// ── IPC handlers ──────────────────────────────────────────────

function setupIpcHandlers(): void {
  /**
   * Report which provider backends are available on this machine.
   *
   * GOTCHA: returns {claude, codex} not {available}; renderer must check
   * the right field based on the thread's provider. Missing one doesn't
   * mean the app is broken — users may only have one CLI installed.
   */
  ipcMain.handle("session:check", () => {
    return {
      claude: claudePath !== null,
      codex: codexInstalled,
    };
  });

  /**
   * Fetch the account-aware Codex model list via the `codex app-server`
   * JSON-RPC protocol. Returns `[]` if Codex isn't installed or the
   * handshake fails — the renderer falls back to a hardcoded list in
   * that case so the picker is never empty.
   */
  ipcMain.handle("codex:list-models", async () => {
    if (!codexInstalled) return [];
    try {
      return await listCodexModels();
    } catch (err) {
      console.error("[codex-models] failed:", err);
      return [];
    }
  });

  /**
   * Fetch the account-aware Claude model list via the Agent SDK's
   * `Query.supportedModels()` control request. Returns `[]` on failure;
   * the renderer falls back to a hardcoded list in that case.
   */
  ipcMain.handle("claude:list-models", async () => {
    if (!claudePath) return [];
    try {
      return await listClaudeModels(claudePath);
    } catch (err) {
      console.error("[claude-models] failed:", err);
      return [];
    }
  });

  /** Send a user message to the selected agent for a given thread. */
  ipcMain.handle(
    "session:send",
    async (
      _event,
      threadId: string,
      message: string,
      opts?: {
        provider?: Provider;
        resumeSessionId?: string;
        projectId?: string;
        images?: unknown;
        model?: string;
        effort?: string;
        userMode?: UserMode;
      },
    ) => {
      // Validate the `images` payload at the boundary. Per CLAUDE.md
      // ("Zod for all external data"), we don't trust renderer-supplied
      // shapes — a stray `path` from a compromised renderer would
      // otherwise reach `session.send` and could be passed straight to
      // Codex's `local_image` (which reads the file).
      let images: ImagePayloadT[] | undefined;
      if (opts?.images !== undefined) {
        const parsed = z.array(ImagePayload).safeParse(opts.images);
        if (!parsed.success) {
          emitToRenderer({
            type: "error",
            threadId,
            message: `Invalid images payload: ${JSON.stringify(parsed.error.issues)}`,
          });
          return;
        }
        images = parsed.data;
      }

      // Resolve provider. The DB is authoritative for any thread we've
      // seen before (keyed by its session id); the renderer-supplied
      // `opts.provider` is only consulted for brand-new threads where
      // no DB row exists yet. This closes a class of bugs where the
      // renderer has stale state and passes the wrong provider for a
      // known session id — we'd otherwise spin up the wrong backend.
      const provider = await resolveProvider(
        opts?.resumeSessionId,
        opts?.provider,
      );

      // Resolve the project's folder as the session cwd
      let cwd: string | undefined;
      if (opts?.projectId) {
        cwd = await getProjectCwd(opts.projectId);
      }

      const session = getOrCreateSession(threadId, provider, {
        resumeSessionId: opts?.resumeSessionId,
        cwd,
        model: opts?.model,
        effort: opts?.effort,
        userMode: opts?.userMode,
      });
      if (!session) {
        const installHint =
          provider === "claude"
            ? "Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code"
            : "Codex CLI not found. Install it with: npm install -g @openai/codex";
        emitToRenderer({ type: "error", threadId, message: installHint });
        return;
      }

      emitToRenderer({ type: "status", threadId, status: "running" });

      let currentSessionId: string | null = opts?.resumeSessionId ?? null;

      session.send(message, images, async (e) => {
        switch (e.kind) {
          case "init": {
            currentSessionId = e.sessionId;
            // A new rollout file will appear on disk for this id; drop
            // the cached index for the relevant provider so the next
            // history / mode lookup rebuilds and picks it up.
            if (provider === "codex") invalidateCodexSessionIndex();
            else invalidateClaudeSessionIndex();
            try {
              await getDb()
                .insert(knownThreads)
                .values({
                  sessionId: e.sessionId,
                  createdAt: Date.now(),
                  projectId: opts?.projectId ?? null,
                  provider,
                  // Negative epoch — sorts above `createdAt`-backfilled
                  // rows and above dense `0..N-1` reorder indices, so
                  // new threads land at the top of their bucket.
                  sortOrder: -Date.now(),
                })
                .onConflictDoNothing();
            } catch (err) {
              console.error("[db] failed to register session:", err);
              emitToRenderer({
                type: "error",
                threadId,
                message:
                  "Failed to save session to database — your conversation won't appear in the sidebar after restart.",
              });
              return;
            }

            emitToRenderer({
              type: "session_init",
              threadId,
              sessionId: e.sessionId,
              provider,
              model: e.model,
              cwd,
              projectId: opts?.projectId,
            });
            break;
          }

          case "text_delta":
            emitToRenderer({
              type: "assistant_text",
              threadId,
              text: e.text,
            });
            break;

          case "tool_use":
            emitToRenderer({
              type: "tool_use",
              threadId,
              ...(e.toolUseId && { toolUseId: e.toolUseId }),
              toolName: e.toolName,
              toolInput: e.toolInput,
            });
            break;

          case "result": {
            // GOTCHA: costUsd/durationMs are null for Codex (no cost
            // reporting, no duration surfaced). Spread conditionally so
            // the downstream Zod schema's optional() check passes.
            const contextStats = {
              ...(e.contextUsage != null && e.contextUsage),
              ...(e.costUsd != null && { costUsd: e.costUsd }),
              ...(e.durationMs != null && { durationMs: e.durationMs }),
            };

            // Persist to DB so it survives restarts
            if (currentSessionId) {
              try {
                await getDb()
                  .update(knownThreads)
                  .set({ contextStats: JSON.stringify(contextStats) })
                  .where(eq(knownThreads.sessionId, currentSessionId));
              } catch (err) {
                console.error("[db] failed to save context stats:", err);
              }
            }

            emitToRenderer({ type: "result", threadId, ...contextStats });
            // Turn is complete — mark thread as idle so user can send follow-ups
            emitToRenderer({ type: "status", threadId, status: "idle" });
            break;
          }

          case "pending_request": {
            // Agent is paused waiting on the user (AskUserQuestion today;
            // approvals/plan-mode in the future). The SDK's `canUseTool`
            // callback has blocked on a Promise that the session's
            // `resolveRequest` method will fulfill. Renderer reads
            // `pending_request.request.kind` to decide what UI to show.
            emitToRenderer({
              type: "pending_request",
              threadId,
              request: e.request,
            });
            emitToRenderer({
              type: "status",
              threadId,
              status: "awaiting_input",
            });
            break;
          }

          case "mode_changed":
            emitToRenderer({ type: "mode_changed", threadId, mode: e.mode });
            break;

          case "plan_card":
            emitToRenderer({ type: "plan_card", threadId, plan: e.plan });
            break;

          case "rate_limit_notice":
            emitToRenderer({
              type: "rate_limit_notice",
              threadId,
              resetAtMs: e.resetAtMs,
              overage: e.overage,
            });
            break;

          case "rate_limit_clear":
            emitToRenderer({ type: "rate_limit_clear", threadId });
            break;

          case "error":
            emitToRenderer({
              type: "error",
              threadId,
              message: e.message,
            });
            break;

          case "done":
            emitToRenderer({ type: "status", threadId, status: "idle" });
            break;
        }
      });
    },
  );

  /** Interrupt the current turn for a thread. */
  ipcMain.handle("session:interrupt", (_event, threadId: string) => {
    sessions.get(threadId)?.interrupt();
  });

  /**
   * Resolve a {@link PendingRequest} (AskUserQuestion answer, or
   * future approval/plan decision). The resolution is validated
   * against {@link RequestResolution} so a misbehaving renderer can't
   * poke an unknown `kind` through to a backend — the Zod parse fails
   * and the handler drops it.
   */
  ipcMain.handle(
    "session:resolve-request",
    async (_event, threadId: string, resolution: unknown) => {
      const session = sessions.get(threadId);
      if (!session) return;
      const parsed = RequestResolution.safeParse(resolution);
      if (!parsed.success) {
        emitToRenderer({
          type: "error",
          threadId,
          message: `Invalid request resolution: ${JSON.stringify(parsed.error.issues)}`,
        });
        return;
      }
      // Every resolution either resumes a paused turn (Claude
      // canUseTool, Codex approval RPCs) or queues a new one
      // (Codex plan approve/reject). "running" is always correct.
      emitToRenderer({ type: "status", threadId, status: "running" });
      await session.resolveRequest(parsed.data);
    },
  );

  /**
   * List sessions started from this UI. Unions Claude's on-disk session
   * history with Codex threads persisted only in our DB.
   *
   * GOTCHA: listSessions() from the Claude SDK only returns Claude
   * threads. Codex stores threads in `~/.codex/sessions` (JSONL) but its
   * SDK does NOT expose a listing API as of 0.121.0. So for Codex we
   * rely entirely on our own `known_threads` rows — if the DB is reset,
   * Codex sidebar entries disappear (but the underlying Codex threads
   * remain resumable if the user knows the thread id).
   */
  ipcMain.handle("session:list-sessions", async (): Promise<SessionInfo[]> => {
    const [claudeSessions, known] = await Promise.all([
      listSessions(),
      getDb()
        .select({
          sessionId: knownThreads.sessionId,
          projectId: knownThreads.projectId,
          customName: knownThreads.customName,
          contextStats: knownThreads.contextStats,
          pinned: knownThreads.pinned,
          archivedAt: knownThreads.archivedAt,
          provider: knownThreads.provider,
          createdAt: knownThreads.createdAt,
          sortOrder: knownThreads.sortOrder,
          pinSortOrder: knownThreads.pinSortOrder,
        })
        .from(knownThreads),
    ]);

    const claudeMap = new Map(claudeSessions.map((s) => [s.sessionId, s]));
    // One tree-walk of `~/.codex/sessions` regardless of how many Codex
    // rows we have. Before this we called `readCodexSummary(id)` per row
    // and each call re-walked the entire sessions tree — O(N·M) in the
    // number of rows × total rollout files. Skip the walk entirely if
    // no row is Codex.
    const hasCodex = known.some((r) => (r.provider ?? "claude") === "codex");
    const hasClaude = known.some((r) => (r.provider ?? "claude") === "claude");
    const codexIndex = hasCodex ? buildCodexSessionIndex() : null;
    const claudeIndex = hasClaude ? buildClaudeSessionIndex() : null;
    const results: SessionInfo[] = [];

    for (const row of known) {
      const provider = (row.provider ?? "claude") as Provider;
      const contextStats = parseContextStats(row.contextStats);
      // Mode resolution order: live in-memory override (user just
      // flipped the dropdown without sending yet) → rollout file's
      // last recorded mode → unset (renderer falls back to its
      // localStorage default).
      const override = pendingModeOverrides.get(row.sessionId);

      if (provider === "claude") {
        // Intersect with on-disk Claude sessions; if the JSONL is gone
        // we skip the row so we don't surface a thread with no history.
        const s = claudeMap.get(row.sessionId);
        if (!s) continue;
        const rolloutFile = claudeIndex?.get(row.sessionId) ?? null;
        const diskMode = rolloutFile ? readClaudeUserModeFromFile(rolloutFile) : null;
        results.push({
          sessionId: s.sessionId,
          provider: "claude",
          summary: row.customName ?? s.summary,
          lastModified: s.lastModified,
          cwd: s.cwd,
          firstPrompt: s.firstPrompt,
          gitBranch: s.gitBranch === "HEAD" ? undefined : s.gitBranch,
          projectId: row.projectId ?? undefined,
          contextStats,
          pinned: row.pinned ?? false,
          ...(row.archivedAt != null ? { archivedAt: row.archivedAt } : {}),
          sortOrder: row.sortOrder,
          pinSortOrder: row.pinSortOrder,
          ...(override ? { userMode: override } : diskMode ? { userMode: diskMode } : {}),
        });
      } else {
        // Codex: enrich from the CLI's on-disk rollout JSONL, since its
        // SDK doesn't expose a listing API. `customName` (user rename)
        // wins; otherwise use the first real user prompt from disk —
        // looked up via the one-shot `codexIndex` so this stays O(1)
        // per row.
        const rolloutFile = codexIndex?.get(row.sessionId) ?? null;
        const diskSummary = rolloutFile
          ? readCodexSummaryFromFile(rolloutFile)
          : null;
        const diskMode = rolloutFile ? readCodexUserModeFromFile(rolloutFile) : null;
        const summary = row.customName ?? diskSummary ?? "Codex thread";
        results.push({
          sessionId: row.sessionId,
          provider: "codex",
          summary,
          lastModified: row.createdAt,
          projectId: row.projectId ?? undefined,
          contextStats,
          pinned: row.pinned ?? false,
          ...(row.archivedAt != null ? { archivedAt: row.archivedAt } : {}),
          sortOrder: row.sortOrder,
          pinSortOrder: row.pinSortOrder,
          ...(override ? { userMode: override } : diskMode ? { userMode: diskMode } : {}),
        });
      }
    }

    return results;
  });

  /**
   * Load message history for a past session.
   *
   * GOTCHA: Codex's SDK doesn't expose a way to read historical
   * thread items programmatically as of 0.121.0, so for Codex we
   * parse the rollout JSONL at ~/.codex/sessions/** directly — same
   * file `codex resume` reads, just surfaced to the UI.
   */
  ipcMain.handle("session:load-history", async (_event, sessionId: string) => {
    // Determine provider from DB. Default to claude for legacy rows.
    const row = await getDb()
      .select({ provider: knownThreads.provider })
      .from(knownThreads)
      .where(eq(knownThreads.sessionId, sessionId))
      .limit(1);
    const provider = (row[0]?.provider ?? "claude") as Provider;
    if (provider === "codex") return readCodexHistory(sessionId);

    const msgs = await getSessionMessages(sessionId);

    // Zod schemas for message body shapes
    const TextBlock = z.object({ type: z.literal("text"), text: z.string() });
    const ImageBlock = z.object({
      type: z.literal("image"),
      source: z.object({
        type: z.literal("base64"),
        media_type: z.string(),
        data: z.string(),
      }),
    });
    const ToolUseBlock = z.object({
      type: z.literal("tool_use"),
      id: z.string(),
      name: z.string(),
      input: z.record(z.string(), z.unknown()).optional(),
    });
    const AnyBlock = z.union([
      TextBlock,
      ImageBlock,
      ToolUseBlock,
      z.object({ type: z.string() }),
    ]);
    const UserBody = z.object({
      role: z.literal("user"),
      content: z.union([z.string(), z.array(AnyBlock)]),
    });
    const AssistantBody = z.object({
      role: z.literal("assistant"),
      content: z.array(AnyBlock),
    });

    type HistoryImage = { mediaType: string; base64: string };
    type HistoryMsg =
      | { id: string; role: "user"; content: string; images?: HistoryImage[] }
      | { id: string; role: "assistant"; content: string }
      | {
          id: string;
          role: "tool_use";
          toolName: string;
          toolInput?: Record<string, unknown>;
        }
      | { id: string; role: "plan"; content: string; planFilePath?: string };

    const result: HistoryMsg[] = [];

    for (const m of msgs) {
      if (m.type === "user") {
        const parsed = UserBody.safeParse(m.message);
        if (!parsed.success) continue;
        let content: string;
        let images: HistoryImage[] | undefined;
        if (typeof parsed.data.content === "string") {
          content = parsed.data.content;
        } else {
          content = parsed.data.content
            .filter((b): b is z.infer<typeof TextBlock> => b.type === "text")
            .map((b) => b.text)
            .join("");
          const imageBlocks = parsed.data.content.filter(
            (b): b is z.infer<typeof ImageBlock> => b.type === "image",
          );
          if (imageBlocks.length > 0) {
            images = imageBlocks.map((b) => ({
              mediaType: b.source.media_type,
              base64: b.source.data,
            }));
          }
        }
        if (content.trim() || images)
          result.push({
            id: m.uuid,
            role: "user",
            content,
            ...(images && { images }),
          });
      } else if (m.type === "assistant") {
        const parsed = AssistantBody.safeParse(m.message);
        if (!parsed.success) continue;
        const blocks = parsed.data.content;
        const textContent = blocks
          .filter((b): b is z.infer<typeof TextBlock> => b.type === "text")
          .map((b) => b.text)
          .join("");
        if (textContent.trim())
          result.push({ id: m.uuid, role: "assistant", content: textContent });
        const toolBlocks = blocks.filter(
          (b): b is z.infer<typeof ToolUseBlock> => b.type === "tool_use",
        );
        for (const t of toolBlocks) {
          result.push({
            id: `${m.uuid}-${t.id}`,
            role: "tool_use",
            toolName: t.name,
            toolInput: t.input,
          });
          // ExitPlanMode is the definitive "plan shown to user" signal
          // (it's the tool that triggers the approval prompt). Emit an
          // additional `plan` item alongside the tool_use indicator so
          // the history matches the live transcript, which shows both
          // the tool call and the PlanApprovalCard.
          if (t.name === "ExitPlanMode") {
            const rawPlan = t.input?.plan;
            const plan = typeof rawPlan === "string" ? rawPlan : "";
            if (plan.trim()) {
              const rawFilePath = t.input?.planFilePath;
              const planFilePath =
                typeof rawFilePath === "string" ? rawFilePath : undefined;
              result.push({
                id: `${m.uuid}-${t.id}-plan`,
                role: "plan",
                content: plan,
                ...(planFilePath && { planFilePath }),
              });
            }
          }
        }
      }
    }

    return result;
  });

  // ── Project CRUD ──────────────────────────────────────────────

  /** Create a project by picking a folder via native dialog. Returns the new project or null if cancelled. */
  ipcMain.handle("projects:create", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      message: "Choose a project folder",
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const folderPath = result.filePaths[0];
    const name = folderPath.split("/").filter(Boolean).at(-1) ?? folderPath;
    const projectId = randomUUID();
    const folderId = randomUUID();
    const now = Date.now();

    const db = getDb();
    await db
      .insert(projects)
      .values({ id: projectId, name, createdAt: now, sortOrder: -now });
    await db
      .insert(projectFolders)
      .values({ id: folderId, projectId, folderPath, createdAt: now });

    return {
      id: projectId,
      name,
      folders: [{ id: folderId, path: folderPath }],
    };
  });

  /** List all projects with their folders, ordered by sidebar sort order. */
  ipcMain.handle("projects:list", async () => {
    const db = getDb();
    const [allProjects, allFolders] = await Promise.all([
      db.select().from(projects).orderBy(asc(projects.sortOrder), asc(projects.createdAt)),
      db.select().from(projectFolders),
    ]);
    return allProjects.map((p) => ({
      id: p.id,
      name: p.name,
      sortOrder: p.sortOrder,
      folders: allFolders
        .filter((f) => f.projectId === p.id)
        .map((f) => ({ id: f.id, path: f.folderPath })),
    }));
  });

  /** Rename a project. */
  ipcMain.handle(
    "projects:rename",
    async (_event, projectId: string, name: string) => {
      await getDb()
        .update(projects)
        .set({ name })
        .where(eq(projects.id, projectId));
    },
  );

  /** Delete a project and all its threads. */
  ipcMain.handle("projects:delete", async (_event, projectId: string) => {
    const db = getDb();
    // Close any live sessions for threads in this project
    const threadRows = await db
      .select({ sessionId: knownThreads.sessionId })
      .from(knownThreads)
      .where(eq(knownThreads.projectId, projectId));
    for (const row of threadRows) {
      const session = sessions.get(row.sessionId);
      if (session) {
        session.close();
        sessions.delete(row.sessionId);
      }
      lastEmittedStatus.delete(row.sessionId);
    }
    await db.delete(knownThreads).where(eq(knownThreads.projectId, projectId));
    await db
      .delete(projectFolders)
      .where(eq(projectFolders.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  /** Add a folder to an existing project. */
  ipcMain.handle(
    "projects:add-folder",
    async (_event, projectId: string, folderPath: string) => {
      const id = randomUUID();
      await getDb()
        .insert(projectFolders)
        .values({ id, projectId, folderPath, createdAt: Date.now() });
      return id;
    },
  );

  /** Remove a folder from a project. */
  ipcMain.handle("projects:remove-folder", async (_event, folderId: string) => {
    await getDb().delete(projectFolders).where(eq(projectFolders.id, folderId));
  });

  /**
   * Persist a new sidebar order for projects. Callers send the full
   * ordered id list; each id's position becomes its `sort_order`. Ids
   * not in the list are left untouched — this isn't a sync-mode
   * endpoint, just a "these N projects are now in this order" write.
   */
  ipcMain.handle("projects:reorder", async (_event, ...args: unknown[]) => {
    const [ids] = parseIpcArgs("projects:reorder", ReorderInput, args);
    if (ids.length === 0) return;
    const db = getDb();
    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx
          .update(projects)
          .set({ sortOrder: i })
          .where(eq(projects.id, ids[i]));
      }
    });
  });

  // ── Git helpers ──────────────────────────────────────────────

  /** Get the current git branch for a directory. */
  ipcMain.handle("git:branch", (_event, cwd: string): string | null => {
    try {
      const branch = execSync("git symbolic-ref --short -q HEAD", {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return branch || null;
    } catch {
      return null;
    }
  });

  /**
   * Open an external URL in the user's default browser.
   *
   * Gated to `http(s)` only — `shell.openExternal` will otherwise
   * happily fire `file://`, `mailto:`, or OS-handled custom schemes,
   * which the renderer has no business triggering. Callers that need
   * anything else should get their own dedicated IPC handler.
   */
  ipcMain.handle(
    "shell:open-external",
    async (_event, url: string): Promise<void> => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          console.warn(
            "[shell:open-external] refused non-http(s) scheme:",
            parsed.protocol,
          );
          return;
        }
        await shell.openExternal(parsed.toString());
      } catch (err) {
        console.error("[shell:open-external] failed:", err);
      }
    },
  );

  // ── Editor integration ──────────────────────────────────────

  /**
   * Open a file or folder in a chosen editor/tool. Relative paths resolve against `cwd`.
   * `editor` selects the target: "vscode" (default), "cursor", "finder",
   * "terminal", "iterm", or "ghostty". For vscode/cursor, a `line` opens
   * the file at that line via `-g path:line`.
   */
  ipcMain.handle(
    "editor:open",
    (
      _event,
      targetPath: string,
      cwd?: string,
      line?: number,
      editor?: EditorTarget,
    ): Promise<{ ok: boolean; message?: string }> => {
      const resolved =
        path.isAbsolute(targetPath) || !cwd
          ? targetPath
          : path.resolve(cwd, targetPath);
      const target = editor ?? "vscode";

      // Detect whether the path is a file (used to give non-editor targets
      // sensible per-file behavior). A line number implies file.
      const isFile: boolean =
        line != null ||
        (() => {
          try {
            return fs.statSync(resolved).isFile();
          } catch {
            return false;
          }
        })();

      if (target === "finder") {
        // For files, reveal-in-Finder; for folders, open the folder.
        if (isFile) {
          try {
            shell.showItemInFolder(resolved);
            return Promise.resolve({ ok: true });
          } catch (err) {
            console.error("[editor:open] finder reveal error:", err);
            return Promise.resolve({
              ok: false,
              message: `Couldn't reveal in Finder: ${err}`,
            });
          }
        }
        return shell.openPath(resolved).then((err) => {
          if (err) {
            console.error("[editor:open] finder error:", err);
            return { ok: false, message: `Couldn't open in Finder: ${err}` };
          }
          return { ok: true };
        });
      }

      // macOS terminal apps — launch via `open -a <AppName> <path>`
      if (target === "terminal" || target === "iterm" || target === "ghostty") {
        // Terminals take a working directory; for files, open the parent dir.
        const openDir = isFile ? path.dirname(resolved) : resolved;
        const appName =
          target === "terminal"
            ? "Terminal"
            : target === "iterm"
              ? "iTerm"
              : "Ghostty";
        return new Promise((resolve) => {
          const child = spawn("open", ["-a", appName, openDir], {
            detached: true,
            stdio: "ignore",
          });
          child.once("error", (err) => {
            console.error("[editor:open] terminal spawn error:", err);
            resolve({
              ok: false,
              message: `Couldn't launch ${appName}. Make sure it's installed.`,
            });
          });
          child.once("spawn", () => {
            child.unref();
            resolve({ ok: true });
          });
        });
      }

      const { bin, label } =
        target === "cursor"
          ? { bin: "cursor", label: "Cursor" }
          : { bin: "code", label: "VSCode" };
      const installHint = `Install the \`${bin}\` command from ${label}'s command palette: "Shell Command: Install '${bin}' command in PATH".`;

      // Open the project workspace first, then navigate to the file. Without
      // the folder arg, `code -g file:line` opens the file as a loose tab in
      // whatever window happens to be frontmost — which is why clicks used
      // to land in an unrelated workspace. Passing the folder makes the
      // editor focus (or open) the window rooted at the project, then jump
      // to the file. Skip the folder arg when the target *is* the folder
      // (the "open project in editor" button) to avoid `code <cwd> <cwd>`.
      const args: string[] = [];
      if (cwd && resolved !== cwd) args.push(cwd);
      if (line != null) {
        args.push("-g", `${resolved}:${line}`);
      } else {
        args.push(resolved);
      }
      return new Promise((resolve) => {
        const child = spawn(bin, args, { detached: true, stdio: "ignore" });
        child.once("error", (err) => {
          console.error("[editor:open] spawn error:", err);
          resolve({
            ok: false,
            message: `Couldn't launch ${label}. ${installHint}`,
          });
        });
        child.once("spawn", () => {
          child.unref();
          resolve({ ok: true });
        });
      });
    },
  );

  // ── Thread CRUD ───────────────────────────────────────────────
  //
  // Inputs are Zod-validated at the boundary. Per CLAUDE.md: "Any data
  // whose shape you don't fully control — IPC messages from another
  // process — MUST be validated with a Zod schema before use." The
  // renderer is sandboxed today, but we don't want DB writes that
  // assume renderer trust. `safeParse` failures throw — that surfaces
  // as a rejected IPC promise, which the renderer reports via
  // `reportIpcError`.

  /** Parse tuple-shaped IPC args or throw a descriptive error. */
  function parseIpcArgs<T>(
    op: string,
    schema: {
      safeParse: (
        v: unknown,
      ) => { success: true; data: T } | { success: false; error: unknown };
    },
    args: unknown[],
  ): T {
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      // `parsed.error` is a `ZodError`; its own `toString()` returns
      // "[object Object]". Prefer the `issues` array (actionable per-
      // field messages) and fall back to `message` then the raw value.
      const err = parsed.error as { issues?: unknown; message?: string };
      const detail = err.issues
        ? JSON.stringify(err.issues)
        : (err.message ?? String(parsed.error));
      throw new Error(`Invalid arguments to ${op}: ${detail}`);
    }
    return parsed.data;
  }

  /** Rename a thread (sets a custom name override). */
  ipcMain.handle("threads:rename", async (_event, ...args: unknown[]) => {
    const [sessionId, name] = parseIpcArgs(
      "threads:rename",
      ThreadsRenameInput,
      args,
    );
    await getDb()
      .update(knownThreads)
      .set({ customName: name })
      .where(eq(knownThreads.sessionId, sessionId));
  });

  /**
   * Pin or unpin a thread.
   *
   * `sortOrder` (home-bucket position) is intentionally NOT touched —
   * that column's sole job is "where does this thread live when it's
   * NOT pinned," so unpinning can return the row to its exact prior
   * slot with zero bookkeeping.
   *
   * On pin, we stamp `pinSortOrder = -Date.now()` so the row floats to
   * the top of the pinned bucket (the pinned-bucket sort uses asc with
   * `lastModified` desc as tiebreaker). `Date.now()` isn't strictly
   * monotonic, so two pins within the same millisecond tie on
   * `pinSortOrder` and fall through to the `lastModified` tiebreaker —
   * harmless at human click speed. On unpin, we clear `pinSortOrder`
   * back to null so a later re-pin stamps a fresh timestamp instead of
   * inheriting a stale pin position.
   */
  ipcMain.handle("threads:pin", async (_event, ...args: unknown[]) => {
    const [sessionId, pinned] = parseIpcArgs(
      "threads:pin",
      ThreadsPinInput,
      args,
    );
    await getDb()
      .update(knownThreads)
      .set(
        pinned
          ? { pinned: true, pinSortOrder: -Date.now() }
          : { pinned: false, pinSortOrder: null },
      )
      .where(eq(knownThreads.sessionId, sessionId));
  });

  /** Archive or unarchive a thread. */
  ipcMain.handle("threads:archive", async (_event, ...args: unknown[]) => {
    const [sessionId, archived] = parseIpcArgs(
      "threads:archive",
      ThreadsArchiveInput,
      args,
    );
    await getDb()
      .update(knownThreads)
      .set({ archivedAt: archived ? Date.now() : null })
      .where(eq(knownThreads.sessionId, sessionId));
  });

  /** Delete a thread from the sidebar. */
  ipcMain.handle("threads:delete", async (_event, ...args: unknown[]) => {
    const [sessionId] = parseIpcArgs(
      "threads:delete",
      ThreadsDeleteInput,
      args,
    );
    // Close the live session if running
    const session = sessions.get(sessionId);
    if (session) {
      session.close();
      sessions.delete(sessionId);
    }
    lastEmittedStatus.delete(sessionId);
    await getDb()
      .delete(knownThreads)
      .where(eq(knownThreads.sessionId, sessionId));
  });

  /**
   * Reassign a thread to a different project (or pass null to ungroup).
   * Only affects the DB row keyed by session_id — live session state is
   * provider-agnostic and doesn't care which project a thread "belongs" to.
   */
  ipcMain.handle(
    "threads:change-project",
    async (_event, ...args: unknown[]) => {
      const [sessionId, projectId] = parseIpcArgs(
        "threads:change-project",
        ThreadsChangeProjectInput,
        args,
      );
      await getDb()
        .update(knownThreads)
        .set({ projectId })
        .where(eq(knownThreads.sessionId, sessionId));
    },
  );

  /**
   * Persist a new sidebar order for threads. The passed list IS the
   * new order (0-based index → column). The `bucket` arg routes the
   * write to the right sort column so the two axes (home-bucket vs
   * pinned-bucket) stay independent:
   *   - "pinned" → `pin_sort_order`
   *   - "home"   → `sort_order`  (per-project list or orphans)
   * Cross-bucket drops aren't allowed by the sidebar; each drop only
   * ever rewrites one bucket's column.
   */
  ipcMain.handle("threads:reorder", async (_event, ...args: unknown[]) => {
    const [bucket, ids] = parseIpcArgs(
      "threads:reorder",
      ThreadsReorderInput,
      args,
    );
    if (ids.length === 0) return;
    const db = getDb();
    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx
          .update(knownThreads)
          .set(bucket === "pinned" ? { pinSortOrder: i } : { sortOrder: i })
          .where(eq(knownThreads.sessionId, ids[i]));
      }
    });
  });

  /**
   * Change the effective {@link UserMode} for a thread.
   *
   * If a live session exists we flip it immediately (Claude: push into
   * the SDK's `setPermissionMode`; Codex: stash for the next turn).
   * If not, we stash in `pendingModeOverrides` so the next send picks
   * it up. Durability comes from the CLI's own rollout file once the
   * next turn fires, so no DB write is needed here.
   */
  ipcMain.handle("threads:set-mode", async (_event, ...args: unknown[]) => {
    const [threadId, mode] = parseIpcArgs(
      "threads:set-mode",
      ThreadsSetModeInput,
      args,
    );
    const session = sessions.get(threadId);
    if (session) {
      await session.setMode(mode, (e) => {
        if (e.kind === "mode_changed") {
          emitToRenderer({ type: "mode_changed", threadId, mode: e.mode });
        }
      });
    } else {
      pendingModeOverrides.set(threadId, mode);
      // Echo to the renderer so the dropdown reflects the new mode
      // immediately even without a live session.
      emitToRenderer({ type: "mode_changed", threadId, mode });
    }
    return mode;
  });
}

// ── Window creation ───────────────────────────────────────────

function createWindow() {
  nativeTheme.themeSource = "dark";

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 800,
    minHeight: 500,

    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    transparent: true,
    vibrancy: "sidebar",
    visualEffectState: "active",
    roundedCorners: true,

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(app.getAppPath(), "dist/preload.cjs"),
    },

    show: false,
  });

  // ── Content-Security-Policy ────────────────────────────────
  //
  // Only applied in packaged builds. Vite's dev server relies on a
  // websocket for HMR and inline scripts for module replacement; a
  // strict CSP would break both. In prod we load `file://`, so we
  // can lock things down.
  //
  // - `default-src 'self'`  — scripts/fonts/etc. only from the bundle.
  // - `style-src  'unsafe-inline'` — Tailwind/React inject inline <style>.
  // - `img-src 'self' data: blob:` — the composer renders `blob:`
  //   object URLs for dragged/pasted image previews and `data:` URLs
  //   for inline screenshots; remote renderer image loads stay
  //   blocked.
  // - `connect-src 'self'` — no outbound renderer fetches; all
  //   network goes through the main process.
  if (!IS_DEV) {
    mainWindow.webContents.session.webRequest.onHeadersReceived(
      (details, cb) => {
        cb({
          responseHeaders: {
            ...details.responseHeaders,
            "Content-Security-Policy": [
              "default-src 'self'; " +
                "script-src 'self'; " +
                "style-src 'self' 'unsafe-inline'; " +
                "img-src 'self' data: blob:; " +
                "font-src 'self' data:; " +
                "connect-src 'self'; " +
                "object-src 'none'; " +
                "base-uri 'self'; " +
                "frame-ancestors 'none'",
            ],
          },
        });
      },
    );
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow!.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // ── Navigation guard ────────────────────────────────────────
  //
  // The renderer is our app — it should never navigate away. If the
  // user clicks an `<a href="https://...">` in assistant markdown and
  // we fail to intercept it at the React layer, Electron's default is
  // to replace the webview with that URL, permanently destroying the
  // app UI with no back button. That actually happened in testing.
  //
  // Belt-and-suspenders: we hijack both entry points and route any
  // http(s) URL to the system browser via `shell.openExternal`. The
  // only permitted in-window navigation is the Vite dev server URL
  // (during `pnpm dev`) and `file://` loads of the packaged bundle.
  //
  // - `will-navigate`: fires for top-level anchor clicks and any
  //   `location.href = ...`.
  // - `setWindowOpenHandler`: fires for `window.open()` and
  //   `target="_blank"` anchors.
  const isInternalUrl = (url: string): boolean => {
    if (url.startsWith("file://")) return true;
    if (IS_DEV && url.startsWith(DEV_URL)) return true;
    // Allow same-origin SPA navigation within the dev server host
    // (e.g. Vite HMR reloads). Production only ever loads from file://.
    if (IS_DEV) {
      try {
        const u = new URL(url);
        const d = new URL(DEV_URL);
        if (u.origin === d.origin) return true;
      } catch {
        /* fall through */
      }
    }
    return false;
  };

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isInternalUrl(url)) return;
    event.preventDefault();
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        void shell.openExternal(parsed.toString());
      }
    } catch {
      // Malformed URL — drop silently rather than navigating anywhere.
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        void shell.openExternal(parsed.toString());
      }
    } catch {
      /* ignore */
    }
    return { action: "deny" };
  });

  if (IS_DEV) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), "web/dist/index.html"));
  }
}

// ── Auto-update ──────────────────────────────────────────────

function checkForUpdates(): void {
  // Only attach a logger in dev. In release builds this routes every
  // update-check heartbeat to stderr, which macOS then captures into
  // the unified system log — noisy and unhelpful for end users.
  if (IS_DEV) autoUpdater.logger = console;
  autoUpdater.on("update-downloaded", (info) => {
    if (!mainWindow) return;
    dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Update Ready",
        message: `Version ${info.version} has been downloaded.`,
        detail: "Restart the app to apply the update.",
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });
  autoUpdater.checkForUpdatesAndNotify();
}

// ── App lifecycle ─────────────────────────────────────────────

app.whenReady().then(async () => {
  await initDb();
  setupIpcHandlers();
  createWindow();

  if (app.isPackaged) {
    checkForUpdates();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Clean up all sessions on quit
app.on("before-quit", () => {
  for (const session of sessions.values()) {
    session.close();
  }
  sessions.clear();
});
