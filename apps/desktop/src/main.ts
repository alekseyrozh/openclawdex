import { app, BrowserWindow, ipcMain, nativeTheme, dialog } from "electron";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;
import { shell } from "electron";
import path from "path";
import { randomUUID } from "crypto";
import { execSync, spawn } from "child_process";
import fs from "fs";
import { eq } from "drizzle-orm";
import { findClaudeBinary, ClaudeSession } from "./claude";
import { isCodexInstalled, CodexSession } from "./codex";
import { readCodexHistory, readCodexSummary } from "./codex-history";
import { listCodexModels } from "./codex-models";
import { listClaudeModels } from "./claude-models";
import type { AgentSession } from "./agent-session";
import {
  listSessions,
  getSessionMessages,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IpcEvent, EditorTarget, Provider, SessionInfo, CodexReasoningEffort, ClaudeEffortLevel } from "@openclawdex/shared";
import { initDb, getDb } from "./db";
import { knownThreads, projects, projectFolders } from "./db/schema";

const DEV_URL = "http://localhost:3000";
const IS_DEV = !app.isPackaged;

// macOS GUI apps don't inherit the shell PATH. Load it so child processes
// (Claude CLI, git, node, etc.) work the same as in the terminal.
if (app.isPackaged && process.platform === "darwin") {
  try {
    const path = execSync("/bin/zsh -ilc 'echo $PATH'", { encoding: "utf-8" }).trim();
    if (path) process.env.PATH = path;
  } catch { /* keep default PATH */ }
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
  },
): AgentSession | null {
  const existing = sessions.get(threadId);
  if (existing) return existing;

  if (provider === "claude") {
    if (!claudePath) return null;
    const session = new ClaudeSession(claudePath, {
      resumeSessionId: opts?.resumeSessionId,
      cwd: opts?.cwd,
      model: opts?.model,
      effort: opts?.effort as ClaudeEffortLevel | undefined,
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
  });
  sessions.set(threadId, session);
  return session;
}

/** Send a validated IPC event to the renderer. */
function emitToRenderer(event: IpcEvent): void {
  mainWindow?.webContents.send("session:event", event);
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
        images?: { name: string; base64: string; mediaType: string }[];
        model?: string;
        effort?: string;
      },
    ) => {
      // Default to claude to match the pre-multi-provider behavior.
      const provider: Provider = opts?.provider ?? "claude";

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
      });
      if (!session) {
        const installHint = provider === "claude"
          ? "Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code"
          : "Codex CLI not found. Install it with: npm install -g @openai/codex";
        emitToRenderer({ type: "error", threadId, message: installHint });
        return;
      }

      emitToRenderer({ type: "status", threadId, status: "running" });

      let currentSessionId: string | null = opts?.resumeSessionId ?? null;

      session.send(message, opts?.images, async (e) => {
        switch (e.kind) {
          case "init": {
            currentSessionId = e.sessionId;
            try {
              await getDb()
                .insert(knownThreads)
                .values({
                  sessionId: e.sessionId,
                  createdAt: Date.now(),
                  projectId: opts?.projectId ?? null,
                  provider,
                })
                .onConflictDoNothing();
            } catch (err) {
              console.error("[db] failed to register session:", err);
              emitToRenderer({ type: "error", threadId, message: "Failed to save session to database — your conversation won't appear in the sidebar after restart." });
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

            if (e.deferredToolUse) {
              // Tool is waiting for user input (e.g. AskUserQuestion) — pause and wait
              emitToRenderer({
                type: "deferred_tool_use",
                threadId,
                toolUseId: e.deferredToolUse.id,
                toolName: e.deferredToolUse.name,
                toolInput: e.deferredToolUse.input,
              });
              emitToRenderer({ type: "status", threadId, status: "awaiting_input" });
            } else {
              // Turn is complete — mark thread as idle so user can send follow-ups
              emitToRenderer({ type: "status", threadId, status: "idle" });
            }
            break;
          }

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

  /** Respond to a deferred tool call (e.g. AskUserQuestion). Claude-only. */
  ipcMain.handle("session:respond-to-tool", (_event, threadId: string, toolUseId: string, responseText: string) => {
    const session = sessions.get(threadId);
    if (!session) return;
    emitToRenderer({ type: "status", threadId, status: "running" });
    session.respondToTool(toolUseId, responseText);
  });

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
      getDb().select({
        sessionId: knownThreads.sessionId,
        projectId: knownThreads.projectId,
        customName: knownThreads.customName,
        contextStats: knownThreads.contextStats,
        pinned: knownThreads.pinned,
        archived: knownThreads.archived,
        provider: knownThreads.provider,
        createdAt: knownThreads.createdAt,
      }).from(knownThreads),
    ]);

    const claudeMap = new Map(claudeSessions.map((s) => [s.sessionId, s]));
    const results: SessionInfo[] = [];

    for (const row of known) {
      const provider = (row.provider ?? "claude") as Provider;
      let contextStats: Record<string, unknown> | undefined;
      try { contextStats = row.contextStats ? JSON.parse(row.contextStats) : undefined; } catch { /* ignore */ }

      if (provider === "claude") {
        // Intersect with on-disk Claude sessions; if the JSONL is gone
        // we skip the row so we don't surface a thread with no history.
        const s = claudeMap.get(row.sessionId);
        if (!s) continue;
        results.push({
          sessionId: s.sessionId,
          provider: "claude",
          summary: row.customName ?? s.summary,
          lastModified: s.lastModified,
          cwd: s.cwd,
          firstPrompt: s.firstPrompt,
          gitBranch: s.gitBranch,
          projectId: row.projectId ?? undefined,
          contextStats,
          pinned: row.pinned ?? false,
          archived: row.archived ?? false,
        });
      } else {
        // Codex: enrich from the CLI's on-disk rollout JSONL, since its
        // SDK doesn't expose a listing API. `customName` (user rename)
        // wins; otherwise use the first real user prompt from disk.
        const summary = row.customName ?? readCodexSummary(row.sessionId) ?? "Codex thread";
        results.push({
          sessionId: row.sessionId,
          provider: "codex",
          summary,
          lastModified: row.createdAt,
          projectId: row.projectId ?? undefined,
          contextStats,
          pinned: row.pinned ?? false,
          archived: row.archived ?? false,
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
    const ToolUseBlock = z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.record(z.string(), z.unknown()).optional() });
    const AnyBlock = z.union([TextBlock, ImageBlock, ToolUseBlock, z.object({ type: z.string() })]);
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
      | { id: string; role: "tool_use"; toolName: string; toolInput?: Record<string, unknown> };

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
          const imageBlocks = parsed.data.content
            .filter((b): b is z.infer<typeof ImageBlock> => b.type === "image");
          if (imageBlocks.length > 0) {
            images = imageBlocks.map((b) => ({
              mediaType: b.source.media_type,
              base64: b.source.data,
            }));
          }
        }
        if (content.trim() || images) result.push({ id: m.uuid, role: "user", content, ...(images && { images }) });
      } else if (m.type === "assistant") {
        const parsed = AssistantBody.safeParse(m.message);
        if (!parsed.success) continue;
        const blocks = parsed.data.content;
        const textContent = blocks
          .filter((b): b is z.infer<typeof TextBlock> => b.type === "text")
          .map((b) => b.text)
          .join("");
        if (textContent.trim()) result.push({ id: m.uuid, role: "assistant", content: textContent });
        const toolBlocks = blocks.filter((b): b is z.infer<typeof ToolUseBlock> => b.type === "tool_use");
        for (const t of toolBlocks) {
          result.push({ id: `${m.uuid}-${t.id}`, role: "tool_use", toolName: t.name, toolInput: t.input });
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
    await db.insert(projects).values({ id: projectId, name, createdAt: now });
    await db.insert(projectFolders).values({ id: folderId, projectId, folderPath, createdAt: now });

    return { id: projectId, name, folders: [{ id: folderId, path: folderPath }] };
  });

  /** List all projects with their folders. */
  ipcMain.handle("projects:list", async () => {
    const db = getDb();
    const [allProjects, allFolders] = await Promise.all([
      db.select().from(projects),
      db.select().from(projectFolders),
    ]);
    return allProjects.map((p) => ({
      id: p.id,
      name: p.name,
      folders: allFolders
        .filter((f) => f.projectId === p.id)
        .map((f) => ({ id: f.id, path: f.folderPath })),
    }));
  });

  /** Rename a project. */
  ipcMain.handle("projects:rename", async (_event, projectId: string, name: string) => {
    await getDb().update(projects).set({ name }).where(eq(projects.id, projectId));
  });

  /** Delete a project and all its threads. */
  ipcMain.handle("projects:delete", async (_event, projectId: string) => {
    const db = getDb();
    // Close any live sessions for threads in this project
    const threadRows = await db.select({ sessionId: knownThreads.sessionId }).from(knownThreads).where(eq(knownThreads.projectId, projectId));
    for (const row of threadRows) {
      const session = sessions.get(row.sessionId);
      if (session) {
        session.close();
        sessions.delete(row.sessionId);
      }
    }
    await db.delete(knownThreads).where(eq(knownThreads.projectId, projectId));
    await db.delete(projectFolders).where(eq(projectFolders.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  /** Add a folder to an existing project. */
  ipcMain.handle("projects:add-folder", async (_event, projectId: string, folderPath: string) => {
    const id = randomUUID();
    await getDb().insert(projectFolders).values({ id, projectId, folderPath, createdAt: Date.now() });
    return id;
  });

  /** Remove a folder from a project. */
  ipcMain.handle("projects:remove-folder", async (_event, folderId: string) => {
    await getDb().delete(projectFolders).where(eq(projectFolders.id, folderId));
  });

  // ── Git helpers ──────────────────────────────────────────────

  /** Get the current git branch for a directory. */
  ipcMain.handle("git:branch", (_event, cwd: string): string | null => {
    try {
      return execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf-8" }).trim();
    } catch {
      return null;
    }
  });

  // ── Editor integration ──────────────────────────────────────

  /**
   * Open a file or folder in a chosen editor/tool. Relative paths resolve against `cwd`.
   * `editor` selects the target: "vscode" (default), "cursor", "finder",
   * "terminal", "iterm", or "ghostty". For vscode/cursor, a `line` opens
   * the file at that line via `-g path:line`.
   */
  ipcMain.handle("editor:open", (_event, targetPath: string, cwd?: string, line?: number, editor?: EditorTarget): Promise<{ ok: boolean; message?: string }> => {
    const resolved = path.isAbsolute(targetPath) || !cwd
      ? targetPath
      : path.resolve(cwd, targetPath);
    const target = editor ?? "vscode";

    // Detect whether the path is a file (used to give non-editor targets
    // sensible per-file behavior). A line number implies file.
    const isFile: boolean = line != null || (() => {
      try { return fs.statSync(resolved).isFile(); } catch { return false; }
    })();

    if (target === "finder") {
      // For files, reveal-in-Finder; for folders, open the folder.
      if (isFile) {
        try {
          shell.showItemInFolder(resolved);
          return Promise.resolve({ ok: true });
        } catch (err) {
          console.error("[editor:open] finder reveal error:", err);
          return Promise.resolve({ ok: false, message: `Couldn't reveal in Finder: ${err}` });
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
        target === "terminal" ? "Terminal" :
        target === "iterm" ? "iTerm" :
        "Ghostty";
      return new Promise((resolve) => {
        const child = spawn("open", ["-a", appName, openDir], { detached: true, stdio: "ignore" });
        child.once("error", (err) => {
          console.error("[editor:open] terminal spawn error:", err);
          resolve({ ok: false, message: `Couldn't launch ${appName}. Make sure it's installed.` });
        });
        child.once("spawn", () => {
          child.unref();
          resolve({ ok: true });
        });
      });
    }

    const { bin, label } = target === "cursor"
      ? { bin: "cursor", label: "Cursor" }
      : { bin: "code", label: "VSCode" };
    const installHint = `Install the \`${bin}\` command from ${label}'s command palette: "Shell Command: Install '${bin}' command in PATH".`;

    const args = line != null ? ["-g", `${resolved}:${line}`] : [resolved];
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
  });

  // ── Thread CRUD ───────────────────────────────────────────────

  /** Rename a thread (sets a custom name override). */
  ipcMain.handle("threads:rename", async (_event, sessionId: string, name: string) => {
    await getDb().update(knownThreads).set({ customName: name }).where(eq(knownThreads.sessionId, sessionId));
  });

  /** Pin or unpin a thread. */
  ipcMain.handle("threads:pin", async (_event, sessionId: string, pinned: boolean) => {
    await getDb().update(knownThreads).set({ pinned }).where(eq(knownThreads.sessionId, sessionId));
  });

  /** Archive or unarchive a thread. */
  ipcMain.handle("threads:archive", async (_event, sessionId: string, archived: boolean) => {
    await getDb().update(knownThreads).set({ archived }).where(eq(knownThreads.sessionId, sessionId));
  });

  /** Delete a thread from the sidebar. */
  ipcMain.handle("threads:delete", async (_event, sessionId: string) => {
    // Close the live session if running
    const session = sessions.get(sessionId);
    if (session) {
      session.close();
      sessions.delete(sessionId);
    }
    await getDb().delete(knownThreads).where(eq(knownThreads.sessionId, sessionId));
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
      preload: path.join(app.getAppPath(), "dist/preload.cjs"),
    },

    show: false,
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow!.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (IS_DEV) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), "web/dist/index.html"));
  }
}

// ── Auto-update ──────────────────────────────────────────────

function checkForUpdates(): void {
  autoUpdater.logger = console;
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
