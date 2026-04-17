import { contextBridge, ipcRenderer } from "electron";
import type { SessionInfo, HistoryMessage, ProjectInfo, EditorTarget, Provider } from "@openclawdex/shared";

contextBridge.exposeInMainWorld("openclawdex", {
  platform: process.platform,

  /**
   * Check which provider backends are available on this machine.
   *
   * GOTCHA: returns both flags because the app is usable even if only
   * one CLI is installed. The model picker UI greys out the
   * unavailable provider's section.
   */
  checkProviders: (): Promise<{ claude: boolean; codex: boolean }> =>
    ipcRenderer.invoke("session:check"),

  /**
   * Send a user message to the agent backing a given thread.
   *
   * `provider`, `model`, `effort` may be passed for new threads so the
   * main process can route to Claude vs Codex and configure the SDK.
   * For resumed threads the persisted `provider` takes precedence over
   * whatever is passed here (main.ts falls back to the arg only when
   * there's no DB row yet, i.e. first turn of a new thread).
   */
  send: (
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
  ): Promise<void> =>
    ipcRenderer.invoke("session:send", threadId, message, opts),

  /** Interrupt the current turn for a thread. */
  interrupt: (threadId: string): Promise<void> =>
    ipcRenderer.invoke("session:interrupt", threadId),

  /**
   * Respond to a deferred tool call (e.g. AskUserQuestion).
   *
   * GOTCHA: only Claude threads ever surface `deferred_tool_use`;
   * calling this on a Codex thread is a harmless no-op in the main
   * process but the UI should never reach it.
   */
  respondToTool: (threadId: string, toolUseId: string, responseText: string): Promise<void> =>
    ipcRenderer.invoke("session:respond-to-tool", threadId, toolUseId, responseText),

  /** List all past sessions (Claude + Codex) across all projects. */
  listSessions: (): Promise<SessionInfo[]> =>
    ipcRenderer.invoke("session:list-sessions"),

  /**
   * Load message history for a session.
   *
   * GOTCHA: Codex threads return an empty array — the Codex SDK
   * does not expose a history read API as of 0.121.0.
   */
  loadHistory: (sessionId: string): Promise<HistoryMessage[]> =>
    ipcRenderer.invoke("session:load-history", sessionId),

  // ── Projects ────────────────────────────────────────────────

  /** Create a project by picking a folder. Returns the new project or null if cancelled. */
  createProject: (): Promise<ProjectInfo | null> =>
    ipcRenderer.invoke("projects:create"),

  /** List all projects with their folders. */
  listProjects: (): Promise<ProjectInfo[]> =>
    ipcRenderer.invoke("projects:list"),

  /** Rename a project. */
  renameProject: (projectId: string, name: string): Promise<void> =>
    ipcRenderer.invoke("projects:rename", projectId, name),

  /** Delete a project. Threads become ungrouped. */
  deleteProject: (projectId: string): Promise<void> =>
    ipcRenderer.invoke("projects:delete", projectId),

  /** Add a folder path to an existing project. Returns the new folder id. */
  addFolder: (projectId: string, folderPath: string): Promise<string> =>
    ipcRenderer.invoke("projects:add-folder", projectId, folderPath),

  /** Remove a folder from a project by folder id. */
  removeFolder: (folderId: string): Promise<void> =>
    ipcRenderer.invoke("projects:remove-folder", folderId),

  // ── Git ─────────────────────────────────────────────────────

  /** Get the current git branch for a directory. */
  getGitBranch: (cwd: string): Promise<string | null> =>
    ipcRenderer.invoke("git:branch", cwd),

  // ── Editor ──────────────────────────────────────────────────

  /** Open a file or folder in an editor. Relative paths resolve against `cwd`. */
  openInEditor: (targetPath: string, cwd?: string, line?: number, editor?: EditorTarget): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke("editor:open", targetPath, cwd, line, editor),

  // ── Threads ─────────────────────────────────────────────────

  /** Rename a thread. */
  renameThread: (sessionId: string, name: string): Promise<void> =>
    ipcRenderer.invoke("threads:rename", sessionId, name),

  /** Pin or unpin a thread. */
  pinThread: (sessionId: string, pinned: boolean): Promise<void> =>
    ipcRenderer.invoke("threads:pin", sessionId, pinned),

  /** Archive or unarchive a thread. */
  archiveThread: (sessionId: string, archived: boolean): Promise<void> =>
    ipcRenderer.invoke("threads:archive", sessionId, archived),

  /** Delete a thread from the sidebar. */
  deleteThread: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke("threads:delete", sessionId),

  /**
   * Subscribe to events coming from the main process.
   * Returns an unsubscribe function.
   */
  onEvent: (callback: (event: unknown) => void): (() => void) => {
    const handler = (_ipc: Electron.IpcRendererEvent, event: unknown) =>
      callback(event);
    ipcRenderer.on("session:event", handler);
    return () => {
      ipcRenderer.removeListener("session:event", handler);
    };
  },
});
