/** Type declarations for the preload bridge exposed on `window.openclawdex`. */

interface OpenClawdexBridge {
  platform: string;
  checkClaude: () => Promise<{ available: boolean }>;
  send: (threadId: string, message: string) => Promise<void>;
  interrupt: (threadId: string) => Promise<void>;
  onEvent: (callback: (event: unknown) => void) => () => void;
}

interface Window {
  openclawdex: OpenClawdexBridge;
}
