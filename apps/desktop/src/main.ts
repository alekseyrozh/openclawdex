import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
import path from "path";
import { findClaudeBinary, ClaudeSession } from "./claude";
import {
  listSessions,
  getSessionMessages,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IpcEvent } from "@openclawdex/shared";

const DEV_URL = "http://localhost:3000";
const IS_DEV = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

// ── Claude state ──────────────────────────────────────────────

const claudePath = findClaudeBinary();
const sessions = new Map<string, ClaudeSession>();

function getOrCreateSession(threadId: string, resumeSessionId?: string): ClaudeSession | null {
  if (!claudePath) return null;
  let session = sessions.get(threadId);
  if (!session) {
    session = new ClaudeSession(claudePath, resumeSessionId);
    sessions.set(threadId, session);
  }
  return session;
}

/** Send a validated IPC event to the renderer. */
function emitToRenderer(event: IpcEvent): void {
  mainWindow?.webContents.send("claude:event", event);
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
    (_event, threadId: string, message: string, resumeSessionId?: string) => {
      const session = getOrCreateSession(threadId, resumeSessionId);
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

      session.send(message, (e) => {
        switch (e.kind) {
          case "init":
            emitToRenderer({
              type: "session_init",
              threadId,
              sessionId: e.sessionId,
              model: e.model,
            });
            break;

          case "text_delta":
            emitToRenderer({
              type: "assistant_text",
              threadId,
              text: e.text,
            });
            break;

          case "result":
            emitToRenderer({
              type: "result",
              threadId,
              costUsd: e.costUsd,
              durationMs: e.durationMs,
            });
            // Turn is complete — mark thread as idle so user can send follow-ups
            emitToRenderer({ type: "status", threadId, status: "idle" });
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

  /** Interrupt the current Claude turn for a thread. */
  ipcMain.handle("claude:interrupt", (_event, threadId: string) => {
    sessions.get(threadId)?.interrupt();
  });

  /** List all past Claude sessions. */
  ipcMain.handle("claude:list-sessions", async () => {
    const all = await listSessions();
    return all.map((s) => ({
      sessionId: s.sessionId,
      summary: s.summary,
      lastModified: s.lastModified,
      cwd: s.cwd,
      firstPrompt: s.firstPrompt,
      gitBranch: s.gitBranch,
    }));
  });

  /** Load message history for a past session. */
  ipcMain.handle("claude:load-history", async (_event, sessionId: string) => {
    const msgs = await getSessionMessages(sessionId);

    type Role = "user" | "assistant";
    type HistoryMsg = { id: string; role: Role; content: string };

    // Zod schemas for message body shapes
    const ContentBlock = z.object({ type: z.string(), text: z.string().optional() });
    const UserBody = z.object({
      role: z.literal("user"),
      content: z.union([z.string(), z.array(ContentBlock)]),
    });
    const AssistantBody = z.object({
      role: z.literal("assistant"),
      content: z.array(ContentBlock),
    });

    const result: HistoryMsg[] = [];

    for (const m of msgs) {
      if (m.type === "user") {
        const parsed = UserBody.safeParse(m.message);
        if (!parsed.success) continue;
        const content =
          typeof parsed.data.content === "string"
            ? parsed.data.content
            : parsed.data.content
                .filter((b) => b.type === "text")
                .map((b) => b.text ?? "")
                .join("");
        if (content.trim()) result.push({ id: m.uuid, role: "user", content });
      } else if (m.type === "assistant") {
        const parsed = AssistantBody.safeParse(m.message);
        if (!parsed.success) continue;
        const content = parsed.data.content
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("");
        if (content.trim()) result.push({ id: m.uuid, role: "assistant", content });
      }
    }

    return result;
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

app.whenReady().then(() => {
  app.dock?.setIcon(path.join(__dirname, "../resources/icon.png"));
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
