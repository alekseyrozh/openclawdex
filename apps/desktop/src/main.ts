import { app, BrowserWindow, ipcMain, nativeTheme, dialog } from "electron";
import path from "path";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { findClaudeBinary, ClaudeSession } from "./claude";
import {
  listSessions,
  getSessionMessages,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IpcEvent } from "@openclawdex/shared";
import { initDb, getDb } from "./db";
import { knownThreads, projects, projectFolders } from "./db/schema";

const DEV_URL = "http://localhost:3000";
const IS_DEV = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

// ── Claude state ──────────────────────────────────────────────

const claudePath = findClaudeBinary();
const sessions = new Map<string, ClaudeSession>();

function getOrCreateSession(
  threadId: string,
  opts?: { resumeSessionId?: string; cwd?: string },
): ClaudeSession | null {
  if (!claudePath) return null;
  let session = sessions.get(threadId);
  if (!session) {
    session = new ClaudeSession(claudePath, opts);
    sessions.set(threadId, session);
  }
  return session;
}

/** Send a validated IPC event to the renderer. */
function emitToRenderer(event: IpcEvent): void {
  mainWindow?.webContents.send("claude:event", event);
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
  /** Check if the claude binary was found. */
  ipcMain.handle("claude:check", () => {
    return { available: claudePath !== null };
  });

  /** Send a user message to Claude for a given thread. */
  ipcMain.handle(
    "claude:send",
    async (_event, threadId: string, message: string, opts?: { resumeSessionId?: string; projectId?: string }) => {
      // Resolve the project's folder as the session cwd
      let cwd: string | undefined;
      if (opts?.projectId) {
        cwd = await getProjectCwd(opts.projectId);
      }

      const session = getOrCreateSession(threadId, { resumeSessionId: opts?.resumeSessionId, cwd });
      if (!session) {
        emitToRenderer({
          type: "error",
          threadId,
          message:
            "Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code",
        });
        return;
      }

      emitToRenderer({ type: "status", threadId, status: "running" });

      let currentSessionId: string | null = opts?.resumeSessionId ?? null;

      session.send(message, async (e) => {
        switch (e.kind) {
          case "init": {
            currentSessionId = e.sessionId;
            try {
              await getDb()
                .insert(knownThreads)
                .values({ sessionId: e.sessionId, createdAt: Date.now(), projectId: opts?.projectId ?? null })
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
            const contextStats = {
              ...(e.contextUsage != null && e.contextUsage),
              costUsd: e.costUsd,
              durationMs: e.durationMs,
            };
            console.log("[main] result — contextStats:", JSON.stringify(contextStats));

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

  /** Interrupt the current Claude turn for a thread. */
  ipcMain.handle("claude:interrupt", (_event, threadId: string) => {
    sessions.get(threadId)?.interrupt();
  });

  /** List only sessions started from this UI. */
  ipcMain.handle("claude:list-sessions", async () => {
    const [all, known] = await Promise.all([
      listSessions(),
      getDb().select({ sessionId: knownThreads.sessionId, projectId: knownThreads.projectId, customName: knownThreads.customName, contextStats: knownThreads.contextStats }).from(knownThreads),
    ]);
    const knownMap = new Map(known.map((r) => [r.sessionId, { projectId: r.projectId ?? undefined, customName: r.customName ?? undefined, contextStats: r.contextStats ?? undefined }]));
    return all
      .filter((s) => knownMap.has(s.sessionId))
      .map((s) => {
        const row = knownMap.get(s.sessionId)!;
        let contextStats: object | undefined;
        try { contextStats = row.contextStats ? JSON.parse(row.contextStats) : undefined; } catch { /* ignore */ }
        return {
          sessionId: s.sessionId,
          summary: row.customName ?? s.summary,
          lastModified: s.lastModified,
          cwd: s.cwd,
          firstPrompt: s.firstPrompt,
          gitBranch: s.gitBranch,
          projectId: row.projectId,
          contextStats,
        };
      });
  });

  /** Load message history for a past session. */
  ipcMain.handle("claude:load-history", async (_event, sessionId: string) => {
    const msgs = await getSessionMessages(sessionId);

    // Zod schemas for message body shapes
    const TextBlock = z.object({ type: z.literal("text"), text: z.string() });
    const ToolUseBlock = z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.record(z.string(), z.unknown()).optional() });
    const AnyBlock = z.union([TextBlock, ToolUseBlock, z.object({ type: z.string() })]);
    const UserBody = z.object({
      role: z.literal("user"),
      content: z.union([z.string(), z.array(AnyBlock)]),
    });
    const AssistantBody = z.object({
      role: z.literal("assistant"),
      content: z.array(AnyBlock),
    });

    type HistoryMsg =
      | { id: string; role: "user"; content: string }
      | { id: string; role: "assistant"; content: string }
      | { id: string; role: "tool_use"; toolName: string; toolInput?: Record<string, unknown> };

    const result: HistoryMsg[] = [];

    for (const m of msgs) {
      if (m.type === "user") {
        const parsed = UserBody.safeParse(m.message);
        if (!parsed.success) continue;
        const content =
          typeof parsed.data.content === "string"
            ? parsed.data.content
            : parsed.data.content
                .filter((b): b is z.infer<typeof TextBlock> => b.type === "text")
                .map((b) => b.text)
                .join("");
        if (content.trim()) result.push({ id: m.uuid, role: "user", content });
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

  // ── Thread CRUD ───────────────────────────────────────────────

  /** Rename a thread (sets a custom name override). */
  ipcMain.handle("threads:rename", async (_event, sessionId: string, name: string) => {
    await getDb().update(knownThreads).set({ customName: name }).where(eq(knownThreads.sessionId, sessionId));
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
      preload: path.join(__dirname, "preload.js"),
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
    mainWindow.loadFile(path.join(__dirname, "../web/dist/index.html"));
  }
}

// ── App lifecycle ─────────────────────────────────────────────

app.whenReady().then(async () => {
  app.dock?.setIcon(path.join(__dirname, "../resources/icon.png"));
  await initDb();
  setupIpcHandlers();
  createWindow();
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
