/** Type declarations for the preload bridge exposed on `window.openclawdex`. */

import type { SessionInfo, HistoryMessage, ProjectInfo } from "@openclawdex/shared";

export {};

declare global {
  interface OpenClawdexBridge {
    platform: string;
    checkClaude: () => Promise<{ available: boolean }>;
    send: (threadId: string, message: string, opts?: { resumeSessionId?: string; projectId?: string; images?: { name: string; base64: string; mediaType: string }[] }) => Promise<void>;
    interrupt: (threadId: string) => Promise<void>;
    respondToTool: (threadId: string, toolUseId: string, responseText: string) => Promise<void>;
    listSessions: () => Promise<SessionInfo[]>;
    loadHistory: (sessionId: string) => Promise<HistoryMessage[]>;
    createProject: () => Promise<ProjectInfo | null>;
    listProjects: () => Promise<ProjectInfo[]>;
    renameProject: (projectId: string, name: string) => Promise<void>;
    deleteProject: (projectId: string) => Promise<void>;
    addFolder: (projectId: string, folderPath: string) => Promise<string>;
    removeFolder: (folderId: string) => Promise<void>;
    getGitBranch: (cwd: string) => Promise<string | null>;
    openInEditor: (targetPath: string, cwd?: string, line?: number) => Promise<{ ok: boolean; message?: string }>;
    renameThread: (sessionId: string, name: string) => Promise<void>;
    pinThread: (sessionId: string, pinned: boolean) => Promise<void>;
    archiveThread: (sessionId: string, archived: boolean) => Promise<void>;
    deleteThread: (sessionId: string) => Promise<void>;
    onEvent: (callback: (event: unknown) => void) => () => void;
  }

  interface Window {
    openclawdex: OpenClawdexBridge;
  }
}
