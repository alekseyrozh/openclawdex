import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("openclawdex", {
  platform: process.platform,

  /** Check if the claude binary is available on this machine. */
  checkClaude: (): Promise<{ available: boolean }> =>
    ipcRenderer.invoke("claude:check"),

  /** Send a user message to Claude for a given thread. */
  send: (threadId: string, message: string): Promise<void> =>
    ipcRenderer.invoke("claude:send", threadId, message),

  /** Interrupt the current Claude turn for a thread. */
  interrupt: (threadId: string): Promise<void> =>
    ipcRenderer.invoke("claude:interrupt", threadId),

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
