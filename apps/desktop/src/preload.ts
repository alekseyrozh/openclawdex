import { contextBridge, ipcRenderer } from "electron";
import type { SessionInfo, HistoryMessage, ProjectInfo } from "@openclawdex/shared";

contextBridge.exposeInMainWorld("openclawdex", {
  platform: process.platform,

  /** Check if the claude binary is available on this machine. */
  checkClaude: (): Promise<{ available: boolean }> =>
    ipcRenderer.invoke("claude:check"),

  /** Send a user message to Claude for a given thread. */
  send: (threadId: string, message: string, opts?: { resumeSessionId?: string; projectId?: string }): Promise<void> =>
    ipcRenderer.invoke("claude:send", threadId, message, opts),

  /** Interrupt the current Claude turn for a thread. */
  interrupt: (threadId: string): Promise<void> =>
    ipcRenderer.invoke("claude:interrupt", threadId),

  /** List all past Claude sessions across all projects. */
  listSessions: (): Promise<SessionInfo[]> =>
    ipcRenderer.invoke("claude:list-sessions"),

  /** Load message history for a session by its session ID. */
  loadHistory: (sessionId: string): Promise<HistoryMessage[]> =>
    ipcRenderer.invoke("claude:load-history", sessionId),

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

  // ── Threads ─────────────────────────────────────────────────

  /** Rename a thread. */
  renameThread: (sessionId: string, name: string): Promise<void> =>
    ipcRenderer.invoke("threads:rename", sessionId, name),

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
    ipcRenderer.on("claude:event", handler);
    return () => {
      ipcRenderer.removeListener("claude:event", handler);
    };
  },
});
