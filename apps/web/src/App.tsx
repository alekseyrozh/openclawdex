import { useState, useCallback, useRef, useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { IpcEvent, SessionInfo, HistoryMessage } from "@openclawdex/shared";

export type Provider = "claude" | "codex";

export interface Thread {
  id: string;
  name: string;
  provider: Provider;
  project: string;
  status: "idle" | "running" | "error";
  messages: Message[];
  branch?: string;
  claudeSessionId?: string;
  historyLoaded?: boolean;
  lastModified: Date;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool_use";
  content: string;
  timestamp: Date;
  fileChanges?: FileChange[];
  collapsed?: number;
  toolName?: string;
}

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
}

let nextMsgId = 1;
function msgId() {
  return `msg-${nextMsgId++}`;
}

function newThread(): Thread {
  return {
    id: crypto.randomUUID(),
    name: "New conversation",
    provider: "claude",
    project: "",
    status: "idle",
    messages: [],
    historyLoaded: true,
    lastModified: new Date(),
  };
}

function sessionToThread(s: SessionInfo): Thread {
  const project = s.cwd ? s.cwd.split("/").filter(Boolean).at(-1) ?? "" : "";
  return {
    id: s.sessionId,
    name: s.summary,
    provider: "claude",
    project,
    status: "idle",
    messages: [],
    branch: s.gitBranch,
    claudeSessionId: s.sessionId,
    historyLoaded: false,
    lastModified: new Date(s.lastModified),
  };
}

function historyToMessages(items: HistoryMessage[]): Message[] {
  return items.map((h) => {
    if (h.role === "tool_use") {
      return { id: h.id, role: "tool_use" as const, content: "", timestamp: new Date(), toolName: h.toolName };
    }
    return { id: h.id, role: h.role, content: h.content, timestamp: new Date() };
  });
}

/** Pure reducer — applies one IPC event to a thread. */
function applyIpcEvent(thread: Thread, event: IpcEvent): Thread {
  switch (event.type) {
    case "assistant_text": {
      const msgs = [...thread.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = { ...last, content: last.content + event.text };
      } else {
        msgs.push({ id: msgId(), role: "assistant", content: event.text, timestamp: new Date() });
      }
      const firstLine = msgs[msgs.length - 1].content.trim().split("\n")[0];
      const name =
        thread.name === "New conversation" && firstLine.length > 0
          ? firstLine.slice(0, 40) + (firstLine.length > 40 ? "..." : "")
          : thread.name;
      return { ...thread, name, messages: msgs };
    }
    case "status":
      return { ...thread, status: event.status };
    case "tool_use":
      return { ...thread, messages: [...thread.messages, { id: msgId(), role: "tool_use" as const, content: "", timestamp: new Date(), toolName: event.toolName }] };
    case "error":
      return { ...thread, status: "error" as const, messages: [...thread.messages, { id: msgId(), role: "assistant" as const, content: `Error: ${event.message}`, timestamp: new Date() }] };
    case "result":
      console.log(`[thread ${thread.id}] cost=$${event.costUsd.toFixed(4)} duration=${event.durationMs}ms`);
      return thread;
    case "session_init": {
      console.log(`[thread ${thread.id}] session=${event.sessionId} model=${event.model}`);
      const project = event.cwd ? event.cwd.split("/").filter(Boolean).at(-1) ?? "" : thread.project;
      return { ...thread, claudeSessionId: event.sessionId, historyLoaded: true, project };
    }
  }
}

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 240;

export function App() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [pendingThread, setPendingThread] = useState<Thread>(newThread);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const pendingThreadRef = useRef(pendingThread);
  pendingThreadRef.current = pendingThread;
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("sidebarWidth");
    const parsed = saved ? parseInt(saved, 10) : NaN;
    return isNaN(parsed) ? SIDEBAR_DEFAULT : Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, parsed));
  });
  const dragging = useRef(false);

  // Real thread if selected, otherwise show the pending (not-yet-committed) thread
  const activeThread: Thread | null = activeThreadId
    ? threads.find((t) => t.id === activeThreadId) ?? null
    : pendingThread;

  // ── Load past sessions on mount ───────────────────────────

  useEffect(() => {
    if (!window.openclawdex?.listSessions) {
      setThreadsLoading(false);
      return;
    }
    window.openclawdex.listSessions().then((sessions) => {
      const parsed = sessions.map((s) => SessionInfo.safeParse(s)).flatMap((r) => r.success ? [r.data] : []);
      if (parsed.length > 0) {
        const historyThreads = parsed
          .sort((a, b) => b.lastModified - a.lastModified)
          .map(sessionToThread);
        setThreads((prev) => {
          // Keep any in-progress threads at the top, history below
          const inProgress = prev.filter((t) => !t.claudeSessionId);
          return [...inProgress, ...historyThreads];
        });
        setActiveThreadId((prev) => prev ?? historyThreads[0]?.id ?? null);
      }
      setThreadsLoading(false);
    }).catch((err) => {
      console.error("[listSessions] failed:", err);
      setThreadsLoading(false);
    });
  }, []);

  // ── IPC event listener ────────────────────────────────────

  useEffect(() => {
    if (!window.openclawdex?.onEvent) return;

    const unsubscribe = window.openclawdex.onEvent((raw: unknown) => {
      const parsed = IpcEvent.safeParse(raw);
      if (!parsed.success) {
        console.warn("[ipc] unrecognized event:", raw);
        return;
      }
      const event = parsed.data;

      // Events for the pending thread are handled separately — it isn't in `threads` yet.
      if (event.threadId === pendingThreadRef.current.id) {
        if (event.type === "session_init") {
          // Now we have cwd — commit the pending thread to the sidebar.
          const project = event.cwd ? event.cwd.split("/").filter(Boolean).at(-1) ?? "" : "";
          const committed = { ...pendingThreadRef.current, claudeSessionId: event.sessionId, historyLoaded: true, project };
          setThreads((prev) => [committed, ...prev]);
          setActiveThreadId((prev) => (prev === null ? committed.id : prev));
          setPendingThread(newThread());
        } else {
          setPendingThread((prev) => applyIpcEvent(prev, event));
        }
        return;
      }

      // Events for already-committed threads.
      setThreads((prev) => prev.map((t) => t.id !== event.threadId ? t : applyIpcEvent(t, event)));
    });

    return unsubscribe;
  }, []);

  // ── Lazy-load history when switching to a history thread ──

  useEffect(() => {
    if (!activeThread || activeThread.historyLoaded || !activeThread.claudeSessionId) return;
    if (!window.openclawdex?.loadHistory) return;

    const { claudeSessionId } = activeThread;
    window.openclawdex.loadHistory(claudeSessionId).then((items) => {
      setThreads((prev) =>
        prev.map((t) =>
          t.id === activeThread.id
            ? { ...t, messages: historyToMessages(items), historyLoaded: true }
            : t,
        ),
      );
    });
  }, [activeThread?.id, activeThread?.historyLoaded]);

  // ── Send message handler ──────────────────────────────────

  const handleSend = useCallback(
    (threadId: string, text: string) => {
      const userMsg: Message = {
        id: msgId(),
        role: "user",
        content: text,
        timestamp: new Date(),
      };

      if (threadId === pendingThreadRef.current.id) {
        // First message — update pendingThread but don't add to sidebar yet.
        // We wait for session_init (which carries cwd/project) before committing.
        const name = text.length > 40 ? text.slice(0, 40) + "…" : text;
        setPendingThread((prev) => ({ ...prev, name, status: "running", messages: [userMsg] }));
        window.openclawdex?.send(pendingThreadRef.current.id, text, undefined);
      } else {
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== threadId) return t;
            return { ...t, status: "running" as const, messages: [...t.messages, userMsg] };
          }),
        );
        const thread = threadsRef.current.find((t) => t.id === threadId);
        window.openclawdex?.send(threadId, text, thread?.claudeSessionId);
      }
    },
    [],
  );

  // ── New thread handler ────────────────────────────────────

  const handleNewThread = useCallback(() => {
    setActiveThreadId(null);
  }, []);

  // ── Interrupt handler ─────────────────────────────────────

  const handleInterrupt = useCallback((threadId: string) => {
    window.openclawdex?.interrupt(threadId);
  }, []);

  // ── Sidebar drag ──────────────────────────────────────────

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX));
      setSidebarWidth(w);
    };

    const onUp = (ev: MouseEvent) => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX));
      localStorage.setItem("sidebarWidth", String(w));
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
        onNewThread={handleNewThread}
        width={sidebarWidth}
        isLoading={threadsLoading}
      />
      {/* Drag handle */}
      <div
        className="w-[2px] shrink-0 cursor-col-resize hover:bg-white/10 active:bg-white/15 transition-colors rounded-full"
        onMouseDown={onDragStart}
        style={{
          marginLeft: "-2px",
          marginRight: "-2px",
          marginTop: "16px",
          marginBottom: "16px",
          zIndex: 10,
        }}
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
        <ChatView
          thread={activeThread ?? null}
          onSend={handleSend}
          onInterrupt={handleInterrupt}
        />
      </div>
    </div>
  );
}
