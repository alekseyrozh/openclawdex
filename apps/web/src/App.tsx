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

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 240;

export function App() {
  const [threads, setThreads] = useState<Thread[]>(() => {
    const t = newThread();
    return [t];
  });
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const [activeThreadId, setActiveThreadId] = useState<string>(() => threads[0].id);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const dragging = useRef(false);

  const activeThread = threads.find((t) => t.id === activeThreadId);

  // ── Load past sessions on mount ───────────────────────────

  useEffect(() => {
    if (!window.openclawdex?.listSessions) return;
    window.openclawdex.listSessions().then((sessions) => {
      const parsed = sessions.map((s) => SessionInfo.safeParse(s)).flatMap((r) => r.success ? [r.data] : []);
      if (parsed.length === 0) return;
      const historyThreads = parsed
        .sort((a, b) => b.lastModified - a.lastModified)
        .map(sessionToThread);
      setThreads((prev) => {
        // Keep any "new conversation" threads at the top, history below
        const newConvos = prev.filter((t) => !t.claudeSessionId);
        return [...newConvos, ...historyThreads];
      });
      setActiveThreadId((prev) => prev || historyThreads[0]?.id || "");
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

      setThreads((prev) =>
        prev.map((t) => {
          if (t.id !== event.threadId) return t;

          switch (event.type) {
            case "assistant_text": {
              const msgs = [...t.messages];
              const last = msgs[msgs.length - 1];
              // Append to existing assistant message, or create one
              if (last?.role === "assistant") {
                msgs[msgs.length - 1] = { ...last, content: last.content + event.text };
              } else {
                msgs.push({ id: msgId(), role: "assistant", content: event.text, timestamp: new Date() });
              }
              const firstLine = msgs[msgs.length - 1].content.trim().split("\n")[0];
              const name =
                t.name === "New conversation" && firstLine.length > 0
                  ? firstLine.slice(0, 40) + (firstLine.length > 40 ? "..." : "")
                  : t.name;
              return { ...t, name, messages: msgs };
            }

            case "status":
              return { ...t, status: event.status };

            case "tool_use":
              return { ...t, messages: [...t.messages, { id: msgId(), role: "tool_use" as const, content: "", timestamp: new Date(), toolName: event.toolName }] };

            case "error":
              return { ...t, status: "error" as const, messages: [...t.messages, { id: msgId(), role: "assistant" as const, content: `Error: ${event.message}`, timestamp: new Date() }] };

            case "result":
              console.log(`[thread ${t.id}] cost=$${event.costUsd.toFixed(4)} duration=${event.durationMs}ms`);
              return t;

            case "session_init":
              console.log(`[thread ${t.id}] session=${event.sessionId} model=${event.model}`);
              return { ...t, claudeSessionId: event.sessionId, historyLoaded: true };
          }
        }),
      );
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

      setThreads((prev) =>
        prev.map((t) => {
          if (t.id !== threadId) return t;
          return {
            ...t,
            status: "running" as const,
            messages: [...t.messages, userMsg],
          };
        }),
      );

      const thread = threadsRef.current.find((t) => t.id === threadId);
      window.openclawdex?.send(threadId, text, thread?.claudeSessionId);
    },
    [],
  );

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
