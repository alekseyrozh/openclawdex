import { useState, useCallback, useRef } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";

export type Provider = "claude" | "codex";

export interface Thread {
  id: string;
  name: string;
  provider: Provider;
  project: string;
  status: "idle" | "running" | "error";
  messages: Message[];
  branch?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  fileChanges?: FileChange[];
  collapsed?: number; // "N previous messages"
}

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
}

const MOCK_THREADS: Thread[] = [
  {
    id: "1",
    name: "Fix auth middleware",
    provider: "claude",
    project: "api-server",
    status: "running",
    branch: "fix/auth-jwt-expiry",
    messages: [
      {
        id: "m1",
        role: "user",
        content:
          "The authentication middleware isn't validating JWT expiry. Tokens work even after they expire.",
        timestamp: new Date(Date.now() - 1000 * 60 * 5),
      },
      {
        id: "m-collapse",
        role: "assistant",
        content: "",
        collapsed: 4,
        timestamp: new Date(Date.now() - 1000 * 60 * 4),
      },
      {
        id: "m4",
        role: "assistant",
        content:
          'The issue is on line 23 in `src/middleware/auth.ts` (line 23). `jwt.decode()` is used instead of `jwt.verify()` — decode skips all validation including expiration.\n\nI replaced `jwt.decode()` with `jwt.verify()` and added an explicit `exp` claim check. I also adjusted the supporting error messages in `src/middleware/auth.ts` (line 31) to distinguish between invalid and expired tokens.',
        timestamp: new Date(Date.now() - 1000 * 60 * 3),
        fileChanges: [
          { path: "src/middleware/auth.ts", additions: 9, deletions: 4 },
        ],
      },
      {
        id: "m5",
        role: "user",
        content:
          "the error messages should be generic for security, don't reveal whether the token is expired vs invalid",
        timestamp: new Date(Date.now() - 1000 * 60 * 2),
      },
      {
        id: "m6",
        role: "assistant",
        content:
          'Made the error response generic in `src/middleware/auth.ts` (line 31). Both the invalid signature and expired token paths now return the same `{ error: "Unauthorized" }` message. Verification passed with `npm test`.',
        timestamp: new Date(Date.now() - 1000 * 60 * 1),
        fileChanges: [
          { path: "src/middleware/auth.ts", additions: 2, deletions: 3 },
        ],
      },
    ],
  },
  {
    id: "2",
    name: "Add rate limiting",
    provider: "codex",
    project: "api-server",
    status: "idle",
    branch: "feat/rate-limit",
    messages: [
      {
        id: "m10",
        role: "user",
        content:
          "Add rate limiting to the API using a sliding window. Use Redis for the counter store.",
        timestamp: new Date(Date.now() - 1000 * 60 * 30),
      },
      {
        id: "m11",
        role: "assistant",
        content:
          "I'll implement a sliding window rate limiter backed by Redis. Checking the existing middleware and Redis setup.",
        timestamp: new Date(Date.now() - 1000 * 60 * 29),
      },
    ],
  },
  {
    id: "3",
    name: "Refactor database layer",
    provider: "claude",
    project: "api-server",
    status: "idle",
    messages: [],
  },
  {
    id: "4",
    name: "Write API docs",
    provider: "codex",
    project: "docs-site",
    status: "error",
    messages: [],
  },
];

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 240;

export function App() {
  const [threads] = useState<Thread[]>(MOCK_THREADS);
  const [activeThreadId, setActiveThreadId] = useState<string>("1");
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const dragging = useRef(false);

  const activeThread = threads.find((t) => t.id === activeThreadId);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX));
      setSidebarWidth(w);
    };

    const onUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  return (
    <div className="flex h-full">
        <Sidebar
          threads={threads}
          activeThreadId={activeThreadId}
          onSelectThread={setActiveThreadId}
          width={sidebarWidth}
        />
        {/* Drag handle */}
        <div
          className="w-[2px] shrink-0 cursor-col-resize hover:bg-white/10 active:bg-white/15 transition-colors rounded-full"
          onMouseDown={onDragStart}
          style={{ marginLeft: "-2px", marginRight: "-2px", marginTop: "16px", marginBottom: "16px", zIndex: 10 }}
        />
        {/* Main content panel */}
        <div
          className="flex-1 flex flex-col min-w-0 overflow-hidden"
          style={{
            background: "var(--surface-0)",
            borderRadius: "16px 0 0 16px",
            border: "1px solid var(--border-default)",
            borderRight: "none",
          }}
        >
          <ChatView thread={activeThread ?? null} />
        </div>
    </div>
  );
}
