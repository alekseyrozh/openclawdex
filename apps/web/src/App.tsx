import { useState, useCallback, useRef, useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { IpcEvent, SessionInfo, HistoryMessage, ProjectInfo, ContextStats } from "@openclawdex/shared";
export type { ContextStats };

export type Provider = "claude" | "codex";

export interface Thread {
  id: string;
  name: string;
  provider: Provider;
  projectId: string | null;
  status: "idle" | "running" | "error" | "awaiting_input";
  messages: Message[];
  branch?: string;
  claudeSessionId?: string;
  historyLoaded?: boolean;
  lastModified: Date;
  contextStats?: ContextStats;
  archived?: boolean;
  needsAttention?: boolean;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool_use";
  content: string;
  timestamp: Date;
  fileChanges?: FileChange[];
  collapsed?: number;
  toolName?: string;
  toolInput?: Record<string, unknown>;
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

function newThread(projectId: string | null): Thread {
  return {
    id: crypto.randomUUID(),
    name: "New conversation",
    provider: "claude",
    projectId,
    status: "idle",
    messages: [],
    historyLoaded: true,
    lastModified: new Date(),
  };
}

const ARCHIVED_LS_PREFIX = "thread-archived:";

function saveArchivedToStorage(threadId: string, archived: boolean) {
  try {
    if (archived) {
      localStorage.setItem(ARCHIVED_LS_PREFIX + threadId, "1");
    } else {
      localStorage.removeItem(ARCHIVED_LS_PREFIX + threadId);
    }
  } catch { /* ignore quota errors */ }
}

function loadArchivedFromStorage(threadId: string): boolean {
  try {
    return localStorage.getItem(ARCHIVED_LS_PREFIX + threadId) === "1";
  } catch { return false; }
}

function sessionToThread(s: SessionInfo): Thread {
  return {
    id: s.sessionId,
    name: s.summary,
    provider: "claude",
    projectId: s.projectId ?? null,
    status: "idle",
    messages: [],
    branch: s.gitBranch,
    claudeSessionId: s.sessionId,
    historyLoaded: false,
    lastModified: new Date(s.lastModified),
    contextStats: s.contextStats,
    archived: loadArchivedFromStorage(s.sessionId),
  };
}

function historyToMessages(items: HistoryMessage[]): Message[] {
  return items.map((h) => {
    if (h.role === "tool_use") {
      return { id: h.id, role: "tool_use" as const, content: "", timestamp: new Date(), toolName: h.toolName, toolInput: h.toolInput };
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
      return { ...thread, messages: [...thread.messages, { id: msgId(), role: "tool_use" as const, content: "", timestamp: new Date(), toolName: event.toolName, toolInput: event.toolInput }] };
    case "error":
      return { ...thread, status: "error" as const, messages: [...thread.messages, { id: msgId(), role: "assistant" as const, content: `Error: ${event.message}`, timestamp: new Date() }] };
    case "result": {
      console.log("[renderer] result event received:", JSON.stringify(event));
      const contextStats: ContextStats = {
        ...(event.totalTokens != null && { totalTokens: event.totalTokens }),
        ...(event.maxTokens != null && { maxTokens: event.maxTokens }),
        ...(event.percentage != null && { percentage: event.percentage }),
        costUsd: event.costUsd,
        durationMs: event.durationMs,
      };
      console.log("[renderer] contextStats set:", JSON.stringify(contextStats));
      return { ...thread, contextStats };
    }
    case "session_init": {
      console.log(`[thread ${thread.id}] session=${event.sessionId} model=${event.model}`);
      return { ...thread, claudeSessionId: event.sessionId, historyLoaded: true };
    }
  }
}

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 240;

export function App() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [pendingThread, setPendingThread] = useState<Thread | null>(null);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const pendingThreadRef = useRef(pendingThread);
  pendingThreadRef.current = pendingThread;
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("sidebarWidth");
    const parsed = saved ? parseInt(saved, 10) : NaN;
    return isNaN(parsed) ? SIDEBAR_DEFAULT : Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, parsed));
  });
  const dragging = useRef(false);

  // Real thread if selected, pending thread if viewing the new-thread composer, or null
  const activeThread: Thread | null = activeThreadId
    ? (activeThreadId === pendingThread?.id ? pendingThread : threads.find((t) => t.id === activeThreadId) ?? null)
    : null;

  // ── Load projects ─────────────────────────────────────────────

  const refreshProjects = useCallback(() => {
    if (!window.openclawdex?.listProjects) return;
    window.openclawdex.listProjects().then((raw) => {
      const parsed = raw.map((p) => ProjectInfo.safeParse(p)).flatMap((r) => r.success ? [r.data] : []);
      setProjects(parsed);
    }).catch((err) => {
      console.error("[listProjects] failed:", err);
    });
  }, []);

  // ── Load past sessions on mount ───────────────────────────────

  useEffect(() => {
    refreshProjects();

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

  // ── IPC event listener ────────────────────────────────────────

  useEffect(() => {
    if (!window.openclawdex?.onEvent) return;

    const unsubscribe = window.openclawdex.onEvent((raw: unknown) => {
      const parsed = IpcEvent.safeParse(raw);
      if (!parsed.success) {
        console.warn("[ipc] unrecognized event:", raw);
        return;
      }
      const event = parsed.data;

      // Events for the pending thread
      if (pendingThreadRef.current && event.threadId === pendingThreadRef.current.id) {
        if (event.type === "session_init") {
          // Commit the pending thread to the sidebar.
          const committed = {
            ...pendingThreadRef.current,
            claudeSessionId: event.sessionId,
            historyLoaded: true,
          };
          setThreads((prev) => [committed, ...prev]);
          // Keep activeThreadId pointing at this thread (same id)
          setPendingThread(null);
        } else {
          setPendingThread((prev) => prev ? applyIpcEvent(prev, event) : prev);
        }
        return;
      }

      // Events for already-committed threads.
      setThreads((prev) => prev.map((t) => {
        if (t.id !== event.threadId) return t;
        const updated = applyIpcEvent(t, event);
        // Mark needs-attention when thread goes idle while not being viewed
        if (event.type === "status" && event.status === "idle" && t.id !== activeThreadIdRef.current) {
          return { ...updated, needsAttention: true };
        }
        return updated;
      }));
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

  // ── Send message handler ──────────────────────────────────────

  const handleSend = useCallback(
    (threadId: string, text: string) => {
      const userMsg: Message = {
        id: msgId(),
        role: "user",
        content: text,
        timestamp: new Date(),
      };

      const pending = pendingThreadRef.current;
      if (pending && threadId === pending.id) {
        // First message on pending thread — update it, send with projectId
        const name = text.length > 40 ? text.slice(0, 40) + "…" : text;
        setPendingThread((prev) => prev ? { ...prev, name, status: "running", messages: [userMsg] } : prev);
        window.openclawdex?.send(pending.id, text, { projectId: pending.projectId ?? undefined });
      } else {
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== threadId) return t;
            return { ...t, status: "running" as const, messages: [...t.messages, userMsg] };
          }),
        );
        const thread = threadsRef.current.find((t) => t.id === threadId);
        window.openclawdex?.send(threadId, text, { resumeSessionId: thread?.claudeSessionId, projectId: thread?.projectId ?? undefined });
      }
    },
    [],
  );

  // ── Select thread (clears attention badge) ────────────────────

  const handleSelectThread = useCallback((id: string) => {
    setActiveThreadId(id);
    setThreads((prev) => prev.map((t) => t.id === id ? { ...t, needsAttention: false } : t));
  }, []);

  // ── New thread within a project ──────────────────────────────

  const handleNewThread = useCallback((projectId: string) => {
    const thread = newThread(projectId);
    setPendingThread(thread);
    setActiveThreadId(thread.id);
  }, []);

  // ── Create project (folder picker) ───────────────────────────

  const handleCreateProject = useCallback(() => {
    if (!window.openclawdex?.createProject) return;
    window.openclawdex.createProject().then((project) => {
      if (!project) return; // cancelled
      const parsed = ProjectInfo.safeParse(project);
      if (parsed.success) {
        setProjects((prev) => [...prev, parsed.data]);
        // Immediately start a new thread in the new project
        const thread = newThread(parsed.data.id);
        setPendingThread(thread);
        setActiveThreadId(thread.id);
      }
    });
  }, []);

  // ── Interrupt handler ─────────────────────────────────────────

  const handleInterrupt = useCallback((threadId: string) => {
    window.openclawdex?.interrupt(threadId);
  }, []);

  // ── Project rename/delete handlers ────────────────────────────

  const handleRenameProject = useCallback((projectId: string, name: string) => {
    window.openclawdex?.renameProject(projectId, name).then(refreshProjects);
  }, [refreshProjects]);

  const handleDeleteProject = useCallback((projectId: string) => {
    window.openclawdex?.deleteProject(projectId).then(() => {
      setThreads((prev) => {
        const removed = prev.filter((t) => t.projectId === projectId);
        if (removed.some((t) => t.id === activeThreadId)) {
          setActiveThreadId(null);
        }
        return prev.filter((t) => t.projectId !== projectId);
      });
      refreshProjects();
    });
  }, [refreshProjects, activeThreadId]);

  // ── Thread rename/delete handlers ─────────────────────────────

  const handleRenameThread = useCallback((threadId: string, name: string) => {
    setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, name } : t));
    const thread = threadsRef.current.find((t) => t.id === threadId);
    if (thread?.claudeSessionId) {
      window.openclawdex?.renameThread(thread.claudeSessionId, name);
    }
  }, []);

  const handleDeleteThread = useCallback((threadId: string) => {
    const thread = threadsRef.current.find((t) => t.id === threadId);
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
    if (activeThreadId === threadId) {
      setActiveThreadId(null);
    }
    if (thread?.claudeSessionId) {
      window.openclawdex?.deleteThread(thread.claudeSessionId);
    }
  }, [activeThreadId]);

  const handleArchiveThread = useCallback((threadId: string) => {
    setThreads((prev) =>
      prev.map((t) => {
        if (t.id !== threadId) return t;
        const archived = !t.archived;
        saveArchivedToStorage(t.claudeSessionId ?? t.id, archived);
        return { ...t, archived };
      }),
    );
    // If archiving the active thread, deselect it
    if (activeThreadId === threadId) {
      const thread = threadsRef.current.find((t) => t.id === threadId);
      if (!thread?.archived) {
        // Currently not archived → about to be archived → deselect
        setActiveThreadId(null);
      }
    }
  }, [activeThreadId]);

  // ── Sidebar drag ──────────────────────────────────────────────

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
        projects={projects}
        activeThreadId={activeThreadId}
        onSelectThread={handleSelectThread}
        onNewThread={handleNewThread}
        onCreateProject={handleCreateProject}
        onRenameProject={handleRenameProject}
        onDeleteProject={handleDeleteProject}
        onRenameThread={handleRenameThread}
        onDeleteThread={handleDeleteThread}
        onArchiveThread={handleArchiveThread}
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
          thread={activeThread}
          onSend={handleSend}
          onInterrupt={handleInterrupt}
        />
      </div>
    </div>
  );
}
