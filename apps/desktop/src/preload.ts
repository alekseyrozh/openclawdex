import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { SessionInfo, HistoryMessage, ProjectInfo, EditorTarget, Provider, CodexModel, ClaudeModel } from "@openclawdex/shared";

contextBridge.exposeInMainWorld("openclawdex", {
  platform: process.platform,

  /**
   * Resolve the absolute OS path for a `File` obtained from drag-drop
   * or a file input.
   *
   * GOTCHA: Electron removed the legacy `File.path` property in v32, so
   * reading it from the renderer now returns `undefined`. The official
   * replacement is `webUtils.getPathForFile()`, which is only callable
   * from a preload script. We expose it through the bridge so the
   * composer can recover the real path for attached images and dragged
   * files/folders (needed by Codex's `local_image` and for inserting
   * @-references into the chat).
   */
  getFilePath: (file: File): string | undefined => {
    try {
      const p = webUtils.getPathForFile(file);
      return p || undefined;
    } catch {
      return undefined;
    }
  },

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
   * Fetch the Codex model list from the CLI's `app-server` JSON-RPC
   * protocol. Returns an empty array if Codex isn't installed or the
   * handshake fails — callers should fall back to a hardcoded list.
   */
  listCodexModels: (): Promise<CodexModel[]> =>
    ipcRenderer.invoke("codex:list-models"),

  /**
   * Fetch the Claude model list via a throwaway Agent SDK query.
   * Returns an empty array if Claude isn't installed or the control
   * request fails — callers should fall back to a hardcoded list.
   */
  listClaudeModels: (): Promise<ClaudeModel[]> =>
    ipcRenderer.invoke("claude:list-models"),

  /**
   * Send a user message to the agent backing a given thread.
   *
   * `provider`, `model`, `effort` may be passed for new threads so the
   * main process can route to Claude vs Codex and configure the SDK.
   * For resumed threads (any call with `resumeSessionId`) the main
   * process looks up `known_threads.provider` and uses the persisted
   * value instead — the passed `provider` is ignored. See
   * `resolveProvider` in main.ts.
   */
  send: (
    threadId: string,
    message: string,
    opts?: {
      provider?: Provider;
      resumeSessionId?: string;
      projectId?: string;
      images?: { name: string; base64: string; mediaType: string; path?: string }[];
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

  // ── Shell ───────────────────────────────────────────────────

  /**
   * Open an external URL in the user's default browser. Main side
   * rejects anything that isn't http(s).
   */
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("shell:open-external", url),

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

  /** Reassign a thread to a different project (or null to ungroup). */
  changeThreadProject: (sessionId: string, projectId: string | null): Promise<void> =>
    ipcRenderer.invoke("threads:change-project", sessionId, projectId),

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
