import { contextBridge, ipcRenderer } from "electron";
import type { SessionInfo, HistoryMessage } from "@openclawdex/shared";

contextBridge.exposeInMainWorld("openclawdex", {
  platform: process.platform,
  cwd: process.cwd(),

  /** Check if the claude binary is available on this machine. */
  checkClaude: (): Promise<{ available: boolean }> =>
    ipcRenderer.invoke("claude:check"),

  /** Send a user message to Claude for a given thread. */
  send: (threadId: string, message: string, resumeSessionId?: string): Promise<void> =>
    ipcRenderer.invoke("claude:send", threadId, message, resumeSessionId),

  /** Interrupt the current Claude turn for a thread. */
  interrupt: (threadId: string): Promise<void> =>
    ipcRenderer.invoke("claude:interrupt", threadId),

  /** List all past Claude sessions across all projects. */
  listSessions: (): Promise<SessionInfo[]> =>
    ipcRenderer.invoke("claude:list-sessions"),

  /** Load message history for a session by its session ID. */
  loadHistory: (sessionId: string): Promise<HistoryMessage[]> =>
    ipcRenderer.invoke("claude:load-history", sessionId),

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
