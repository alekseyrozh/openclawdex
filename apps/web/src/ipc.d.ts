/** Type declarations for the preload bridge exposed on `window.openclawdex`. */

import type { SessionInfo, HistoryMessage, ProjectInfo, EditorTarget, Provider, CodexModel, ClaudeModel, ImagePayload, RequestResolution, UserMode } from "@openclawdex/shared";

export {};

declare global {
  interface OpenClawdexBridge {
    platform: string;
    /**
     * Resolve the absolute OS path of a `File` (drag-drop or file input).
     * Returns `undefined` when Electron can't map it (e.g. synthesized
     * blob from clipboard paste). Replaces the legacy `File.path` which
     * was removed in Electron 32.
     */
    getFilePath: (file: File) => string | undefined;
    checkProviders: () => Promise<{ claude: boolean; codex: boolean }>;
    listCodexModels: () => Promise<CodexModel[]>;
    listClaudeModels: () => Promise<ClaudeModel[]>;
    send: (
      threadId: string,
      message: string,
      opts?: {
        provider?: Provider;
        resumeSessionId?: string;
        projectId?: string;
        images?: ImagePayload[];
        model?: string;
        effort?: string;
        userMode?: UserMode;
      },
    ) => Promise<void>;
    interrupt: (threadId: string) => Promise<void>;
    resolveRequest: (threadId: string, resolution: RequestResolution) => Promise<void>;
    listSessions: () => Promise<SessionInfo[]>;
    loadHistory: (sessionId: string) => Promise<HistoryMessage[]>;
    createProject: () => Promise<ProjectInfo | null>;
    listProjects: () => Promise<ProjectInfo[]>;
    renameProject: (projectId: string, name: string) => Promise<void>;
    deleteProject: (projectId: string) => Promise<void>;
    addFolder: (projectId: string, folderPath: string) => Promise<string>;
    removeFolder: (folderId: string) => Promise<void>;
    reorderProjects: (orderedIds: string[]) => Promise<void>;
    getGitBranch: (cwd: string) => Promise<string | null>;
    openExternal: (url: string) => Promise<void>;
    openInEditor: (targetPath: string, cwd?: string, line?: number, editor?: EditorTarget) => Promise<{ ok: boolean; message?: string }>;
    renameThread: (sessionId: string, name: string) => Promise<void>;
    pinThread: (sessionId: string, pinned: boolean) => Promise<void>;
    archiveThread: (sessionId: string, archived: boolean) => Promise<void>;
    deleteThread: (sessionId: string) => Promise<void>;
    changeThreadProject: (sessionId: string, projectId: string | null) => Promise<void>;
    reorderThreads: (orderedIds: string[]) => Promise<void>;
    setThreadMode: (threadId: string, mode: UserMode) => Promise<UserMode>;
    onEvent: (callback: (event: unknown) => void) => () => void;
  }

  interface Window {
    openclawdex: OpenClawdexBridge;
  }
}
