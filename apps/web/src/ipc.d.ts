/** Type declarations for the preload bridge exposed on `window.openclawdex`. */

import type { SessionInfo, HistoryMessage } from "@openclawdex/shared";

export {};

declare global {
  interface OpenClawdexBridge {
    platform: string;
    cwd: string;
    checkClaude: () => Promise<{ available: boolean }>;
    send: (threadId: string, message: string, resumeSessionId?: string) => Promise<void>;
    interrupt: (threadId: string) => Promise<void>;
    listSessions: () => Promise<SessionInfo[]>;
    loadHistory: (sessionId: string) => Promise<HistoryMessage[]>;
    onEvent: (callback: (event: unknown) => void) => () => void;
  }

  interface Window {
    openclawdex: OpenClawdexBridge;
  }
}
