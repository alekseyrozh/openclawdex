import { useState, useCallback, useRef, useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import type { ImagePayload } from "./components/ChatView";
import { IpcEvent, SessionInfo, HistoryMessage, ProjectInfo, ContextStats, type Provider, type PendingRequest, type UserMode } from "@openclawdex/shared";
export type { ContextStats, Provider, UserMode };

export interface Thread {
  id: string;
  name: string;
  provider: Provider;
  projectId: string | null;
  status: "idle" | "running" | "error" | "awaiting_input";
  messages: Message[];
  branch?: string;
  // Populated once the backend assigns a session/thread id (post first turn).
  // The column name is provider-neutral because both Claude and Codex use
  // a single "session id" / "thread id" string that resumes the conversation.
  sessionId?: string;
  // Currently-selected model for this thread (from the unified model
  // picker). Carried on the thread so resumes remember the choice.
  model?: string;
  // Reasoning effort, with provider-specific vocabulary (see ChatView).
  effort?: string;
  /**
   * UI-level permission mode. Authoritative source on first render is
   * the backend (derived from the CLI rollout file by main.ts); we
   * reconcile on every `mode_changed` event, which fires both on
   * user-initiated dropdown changes and on model-initiated
   * `EnterPlanMode` / `ExitPlanMode` calls. New threads initialize
   * from `localStorage.lastUserMode`, falling back to `bypassPermissions`.
   */
  userMode: UserMode;
  historyLoaded?: boolean;
  lastModified: Date;
  contextStats?: ContextStats;
  archived?: boolean;
  pinned?: boolean;
  needsAttention?: boolean;
  /**
   * The open pause-for-input request, if any. Set when the backend
   * emits a `pending_request` IPC event and cleared the moment the
   * user submits a resolution. `request.kind` drives which renderer
   * (e.g. QuestionCard for `ask_user_question`) handles the input.
   */
  pendingRequest?: PendingRequest;
}

export interface MessageImage {
  url: string;
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
  /**
   * Backend-provided stable id for a tool call (Codex `item.id`, or
   * Claude's block id). When set, reconciliation in `applyIpcEvent`
   * matches on this rather than appending — lets Codex update a
   * "running" shell card in place when the command finishes.
   */
  toolUseId?: string;
  images?: MessageImage[];
  /**
   * When this user message is the reply to an AskUserQuestion, carry
   * the structured {question, value} pairs so the renderer can show a
   * collapsible "Asked N questions" summary instead of a plain text
   * bubble. `content` still holds the plaintext fallback.
   */
  questionAnswers?: Array<{ question: string; value: string }>;
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

/**
 * Uniform error handling for renderer→main IPC failures.
 *
 * `op` is a user-facing verb phrase ("Delete thread", "Move thread to
 * project") — it appears in the alert, so phrase it from the user's POV.
 * Use `reportIpcError` for user-initiated actions where the person
 * should know the request didn't land; use `logIpcError` for background
 * / cosmetic operations (git branch lookup, project listing on mount)
 * where an alert would be more annoying than informative.
 *
 * Both funnel through `console.error` so Sentry-style log scrapers pick
 * them up uniformly. No toast infra exists yet — `alert()` mirrors the
 * fallback already used by `openInEditor` in ChatView.
 */
function logIpcError(op: string, err: unknown): void {
  console.error(`[${op}] failed:`, err);
}
function reportIpcError(op: string, err: unknown): void {
  logIpcError(op, err);
  const msg = err instanceof Error ? err.message : String(err);
  alert(`${op} failed: ${msg}`);
}

function lastSavedProvider(): Provider {
  try {
    const raw = localStorage.getItem("lastSelection");
    if (!raw) return "claude";
    const saved = JSON.parse(raw);
    if (saved?.provider === "codex") return "codex";
  } catch {}
  return "claude";
}

const USER_MODE_STORAGE_KEY = "lastUserMode";
const USER_MODES: readonly UserMode[] = ["plan", "ask", "acceptEdits", "bypassPermissions"];

function lastSavedUserMode(): UserMode {
  try {
    const raw = localStorage.getItem(USER_MODE_STORAGE_KEY);
    if (raw && (USER_MODES as readonly string[]).includes(raw)) {
      return raw as UserMode;
    }
  } catch {}
  return "bypassPermissions";
}

function newThread(projectId: string | null, provider: Provider = lastSavedProvider()): Thread {
  return {
    id: crypto.randomUUID(),
    name: "New conversation",
    provider,
    projectId,
    status: "idle",
    messages: [],
    historyLoaded: true,
    lastModified: new Date(),
    userMode: lastSavedUserMode(),
  };
}

function sessionToThread(s: SessionInfo): Thread {
  return {
    id: s.sessionId,
    name: s.summary,
    provider: s.provider,
    projectId: s.projectId ?? null,
    status: "idle",
    messages: [],
    branch: s.gitBranch,
    sessionId: s.sessionId,
    historyLoaded: false,
    lastModified: new Date(s.lastModified),
    contextStats: s.contextStats,
    archived: s.archived ?? false,
    pinned: s.pinned ?? false,
    userMode: s.userMode ?? "bypassPermissions",
  };
}

function historyToMessages(items: HistoryMessage[]): Message[] {
  return items.map((h) => {
    if (h.role === "tool_use") {
      return { id: h.id, role: "tool_use" as const, content: "", timestamp: new Date(), toolName: h.toolName, toolInput: h.toolInput };
    }
    const images: MessageImage[] | undefined =
      h.role === "user" && h.images && h.images.length > 0
        ? h.images.map((img) => ({
            url: `data:${img.mediaType};base64,${img.base64}`,
          }))
        : undefined;
    return { id: h.id, role: h.role, content: h.content, timestamp: new Date(), ...(images && { images }) };
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
    case "tool_use": {
      // When the event carries a `toolUseId`, dedupe against any
      // existing tool_use message with the same backing id — the
      // backend is streaming a card update (e.g. Codex's shell command
      // transitioning from "running" to "completed with output").
      // Without a toolUseId we just append, matching Claude's
      // once-per-call semantics.
      if (event.toolUseId) {
        const existingIdx = thread.messages.findIndex(
          (m) => m.role === "tool_use" && m.toolUseId === event.toolUseId,
        );
        if (existingIdx !== -1) {
          const msgs = [...thread.messages];
          msgs[existingIdx] = {
            ...msgs[existingIdx],
            toolName: event.toolName,
            toolInput: event.toolInput,
          };
          return { ...thread, messages: msgs };
        }
        return {
          ...thread,
          messages: [
            ...thread.messages,
            {
              id: msgId(),
              role: "tool_use" as const,
              content: "",
              timestamp: new Date(),
              toolUseId: event.toolUseId,
              toolName: event.toolName,
              toolInput: event.toolInput,
            },
          ],
        };
      }
      return {
        ...thread,
        messages: [
          ...thread.messages,
          {
            id: msgId(),
            role: "tool_use" as const,
            content: "",
            timestamp: new Date(),
            toolName: event.toolName,
            toolInput: event.toolInput,
          },
        ],
      };
    }
    case "error":
      return { ...thread, status: "error" as const, messages: [...thread.messages, { id: msgId(), role: "assistant" as const, content: `Error: ${event.message}`, timestamp: new Date() }] };
    case "result": {
      // GOTCHA: costUsd and durationMs are optional in the IPC schema
      // because Codex's turn.completed event does not report them.
      // Must spread conditionally or downstream consumers get `undefined`
      // where they expected a number.
      const contextStats: ContextStats = {
        ...(event.totalTokens != null && { totalTokens: event.totalTokens }),
        ...(event.maxTokens != null && { maxTokens: event.maxTokens }),
        ...(event.percentage != null && { percentage: event.percentage }),
        ...(event.costUsd != null && { costUsd: event.costUsd }),
        ...(event.durationMs != null && { durationMs: event.durationMs }),
      };
      return { ...thread, contextStats };
    }
    case "session_init": {
      return { ...thread, sessionId: event.sessionId, provider: event.provider, historyLoaded: true };
    }
    case "pending_request": {
      return { ...thread, pendingRequest: event.request };
    }
    case "mode_changed": {
      return { ...thread, userMode: event.mode };
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
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
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
  const sidebarRef = useRef<HTMLDivElement>(null);

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
      logIpcError("List projects", err);
    });
  }, []);

  // ── Initial bootstrap on mount ────────────────────────────────
  //
  // Load projects and sessions together via `Promise.all` so all
  // the derived state (projects list, thread list, default pending
  // thread, active id) commits in a single React render. If we
  // fired them independently the hero could briefly render "What
  // are we building today?" — its no-project fallback — before
  // `projects` populated and it re-rendered with the project name.
  // One `.then` means one render, no flash.

  useEffect(() => {
    const bridge = window.openclawdex;
    if (!bridge?.listProjects || !bridge?.listSessions) {
      setThreadsLoading(false);
      return;
    }

    Promise.all([bridge.listProjects(), bridge.listSessions()])
      .then(([rawProjects, rawSessions]) => {
        const parsedProjects = rawProjects
          .map((p) => ProjectInfo.safeParse(p))
          .flatMap((r) => (r.success ? [r.data] : []));
        setProjects(parsedProjects);

        const parsedSessions = rawSessions
          .map((s) => SessionInfo.safeParse(s))
          .flatMap((r) => (r.success ? [r.data] : []));

        if (parsedSessions.length > 0) {
          const historyThreads = parsedSessions
            .sort((a, b) => b.lastModified - a.lastModified)
            .map(sessionToThread);
          setThreads((prev) => {
            const inProgress = prev.filter((t) => !t.sessionId);
            return [...inProgress, ...historyThreads];
          });

          // Default landing view: open an unsent "new chat" scoped
          // to the most-recently-interacted project, so the user
          // can start typing without first hunting through the
          // sidebar. The hero's built-in project-switcher dropdown
          // lets them retarget if this guess is wrong.
          //
          // Respect a selection the user may have made while the
          // bootstrap was in flight (e.g. clicked a sidebar row).
          // If no history thread carries a projectId — rare, but
          // possible for legacy sessions — fall back to opening the
          // most recent thread so we don't regress the old behavior.
          //
          // The no-projects-at-all bootstrap is handled separately.
          if (!activeThreadIdRef.current) {
            const recentProjectId = historyThreads.find((t) => t.projectId)?.projectId ?? null;
            if (recentProjectId) {
              const pending = newThread(recentProjectId);
              setPendingThread(pending);
              setActiveThreadId(pending.id);
            } else {
              setActiveThreadId(historyThreads[0].id);
            }
          }
        }
        setThreadsLoading(false);
      })
      .catch((err) => {
        logIpcError("Initial bootstrap", err);
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
            sessionId: event.sessionId,
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
    if (!activeThread || activeThread.historyLoaded || !activeThread.sessionId) return;
    if (!window.openclawdex?.loadHistory) return;

    const { sessionId } = activeThread;
    window.openclawdex.loadHistory(sessionId).then((items) => {
      setThreads((prev) =>
        prev.map((t) =>
          t.id === activeThread.id
            ? { ...t, messages: historyToMessages(items), historyLoaded: true }
            : t,
        ),
      );
    }).catch((err) => {
      // Mark historyLoaded so the empty-state hero appears instead of an
      // indefinite loading shell, but surface the failure — the user
      // opened this thread and is now looking at an empty pane.
      reportIpcError("Load conversation history", err);
      setThreads((prev) =>
        prev.map((t) =>
          t.id === activeThread.id ? { ...t, historyLoaded: true } : t,
        ),
      );
    });
  }, [activeThread?.id, activeThread?.historyLoaded]);

  // ── Resolve git branch for the active thread if missing ──────

  useEffect(() => {
    if (!activeThread || activeThread.branch) return;
    const project = projects.find((p) => p.id === activeThread.projectId);
    const cwd = project?.folders[0]?.path;
    if (!cwd || !window.openclawdex?.getGitBranch) return;

    const threadId = activeThread.id;
    window.openclawdex.getGitBranch(cwd).then((branch) => {
      if (!branch) return;
      setPendingThread((prev) => prev && prev.id === threadId ? { ...prev, branch } : prev);
      setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, branch } : t));
    }).catch((err) => {
      // Branch label is purely cosmetic — don't alert.
      logIpcError("Resolve git branch", err);
    });
  }, [activeThread?.id, activeThread?.branch, projects]);

  // ── Send message handler ──────────────────────────────────────

  const handleSend = useCallback(
    (threadId: string, text: string, images?: ImagePayload[], opts?: { model?: string; effort?: string }) => {
      const msgImages: MessageImage[] | undefined = images?.map((img) => ({
        url: `data:${img.mediaType};base64,${img.base64}`,
      }));

      const userMsg: Message = {
        id: msgId(),
        role: "user",
        content: text,
        timestamp: new Date(),
        ...(msgImages && msgImages.length > 0 && { images: msgImages }),
      };

      const pending = pendingThreadRef.current;
      if (pending && threadId === pending.id) {
        // First message on pending thread — update it, send with provider/model/effort
        const name = text.length > 40 ? text.slice(0, 40) + "…" : text;
        setPendingThread((prev) => prev ? { ...prev, name, status: "running", messages: [userMsg], ...(opts?.model && { model: opts.model }), ...(opts?.effort && { effort: opts.effort }) } : prev);
        // The Promise resolves when main dispatches; stream errors are
        // surfaced separately as IpcError events. A Promise-rejection
        // here means the IPC plumbing itself failed (unexpected).
        window.openclawdex?.send(pending.id, text, {
          provider: pending.provider,
          projectId: pending.projectId ?? undefined,
          images,
          model: opts?.model,
          effort: opts?.effort,
          userMode: pending.userMode,
        })?.catch((err) => reportIpcError("Send message", err));
      } else {
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== threadId) return t;
            return { ...t, status: "running" as const, messages: [...t.messages, userMsg], ...(opts?.model && { model: opts.model }), ...(opts?.effort && { effort: opts.effort }) };
          }),
        );
        const thread = threadsRef.current.find((t) => t.id === threadId);
        window.openclawdex?.send(threadId, text, {
          provider: thread?.provider,
          resumeSessionId: thread?.sessionId,
          projectId: thread?.projectId ?? undefined,
          images,
          model: opts?.model,
          effort: opts?.effort,
          userMode: thread?.userMode,
        })?.catch((err) => reportIpcError("Send message", err));
      }
    },
    [],
  );

  // ── Change provider on pending thread (before first turn commits) ──
  //
  // Once the first turn lands and session_init fires, `provider` becomes
  // authoritative in the DB and we no longer allow flipping it here.
  const handleUpdateThreadProvider = useCallback((threadId: string, provider: Provider) => {
    setPendingThread((prev) => prev && prev.id === threadId ? { ...prev, provider } : prev);
  }, []);

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
    // Git branch is resolved by the useEffect above once this thread becomes active.
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
        // Git branch is resolved by the useEffect once this thread becomes active.
      }
    }).catch((err) => reportIpcError("Create project", err));
  }, []);

  /**
   * Create a project via folder picker and return it, WITHOUT spawning
   * a new thread. Used by the in-chat project-switcher dropdown to
   * create-and-reassign the current thread in one flow.
   */
  const handleCreateProjectBare = useCallback((): Promise<ProjectInfo | null> => {
    if (!window.openclawdex?.createProject) return Promise.resolve(null);
    return window.openclawdex.createProject().then((project) => {
      if (!project) return null;
      const parsed = ProjectInfo.safeParse(project);
      if (!parsed.success) return null;
      setProjects((prev) => [...prev, parsed.data]);
      return parsed.data;
    }).catch((err) => {
      reportIpcError("Create project", err);
      return null;
    });
  }, []);

  // ── Top-level "New chat" (no project specified) ──────────────
  //
  // Resolves the target project using this priority:
  //   1. Active thread's project (you're viewing repo X → new chat in X)
  //   2. Most-recently-modified thread's project
  //   3. First available project
  //   4. Fall back to the folder picker (which auto-starts a thread)
  const handleNewChat = useCallback(() => {
    const activeId = activeThreadIdRef.current;
    const active =
      activeId && activeId === pendingThreadRef.current?.id
        ? pendingThreadRef.current
        : threadsRef.current.find((t) => t.id === activeId) ?? null;

    let projectId: string | null = active?.projectId ?? null;

    if (!projectId) {
      const mostRecent = [...threadsRef.current]
        .filter((t) => t.projectId)
        .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())[0];
      projectId = mostRecent?.projectId ?? null;
    }

    if (!projectId && projects.length > 0) {
      projectId = projects[0].id;
    }

    if (projectId) {
      handleNewThread(projectId);
    } else {
      handleCreateProject();
    }
  }, [projects, handleNewThread, handleCreateProject]);

  // ── Auto-spawn a pending thread when nothing is selected ──────
  //
  // Deleting/archiving the active thread — or deleting the project
  // that owns it — leaves activeThreadId=null. With projects still
  // around, the old fallback was a dead "no thread selected" pane.
  // Instead, immediately open a fresh pending thread so the user
  // always lands on either a usable composer (≥1 project) or the
  // zero-project "Add a project" hero.
  useEffect(() => {
    if (threadsLoading) return;
    if (activeThreadId !== null) return;
    if (projects.length === 0) return;
    handleNewChat();
  }, [activeThreadId, projects.length, threadsLoading, handleNewChat]);

  // ── Keyboard shortcut: Cmd/Ctrl+N → new thread ────────────────
  //
  // Mirrors the sidebar's "New thread" button. Scoped globally so it
  // fires regardless of which pane has focus; we skip while the user
  // is typing in an editable field so the native browser shortcut
  // (if any) still wins, and we ignore when a modifier-less `n` would
  // otherwise collide.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.shiftKey || e.altKey) return;
      if (e.key !== "n" && e.key !== "N") return;
      e.preventDefault();
      handleNewChat();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleNewChat]);

  /**
   * Reassign a thread to a different project. Pending threads (no
   * session row yet) live in renderer state only — just update
   * `pendingThread`. For saved threads we update optimistically and
   * revert on DB failure.
   */
  const handleChangeThreadProject = useCallback(
    (threadId: string, projectId: string | null) => {
      if (pendingThreadRef.current?.id === threadId) {
        setPendingThread((prev) => (prev ? { ...prev, projectId } : prev));
        return;
      }
      const thread = threadsRef.current.find((t) => t.id === threadId);
      if (!thread) return;
      const prevProjectId = thread.projectId;
      if (prevProjectId === projectId) return;
      setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, projectId } : t)));
      if (thread.sessionId && window.openclawdex?.changeThreadProject) {
        window.openclawdex.changeThreadProject(thread.sessionId, projectId).catch((err) => {
          reportIpcError("Move thread to project", err);
          // Roll back optimistic UI so sidebar matches DB.
          setThreads((prev) =>
            prev.map((t) => (t.id === threadId ? { ...t, projectId: prevProjectId } : t)),
          );
        });
      }
    },
    [],
  );

  // ── Resolve a pending request (e.g. AskUserQuestion answer) ──

  const handleResolveRequest = useCallback(
    (
      threadId: string,
      request: PendingRequest,
      payload: {
        answers: Record<string, string>;
        displayText: string;
        questionAnswers: Array<{ question: string; value: string }>;
      },
    ) => {
      const userMsg: Message = {
        id: msgId(),
        role: "user",
        content: payload.displayText,
        timestamp: new Date(),
        questionAnswers: payload.questionAnswers,
      };

      // Update thread: add user message, clear pending, set running
      const updateThread = (t: Thread): Thread =>
        t.id === threadId
          ? { ...t, status: "running" as const, pendingRequest: undefined, messages: [...t.messages, userMsg] }
          : t;

      if (pendingThreadRef.current?.id === threadId) {
        setPendingThread((prev) => prev ? updateThread(prev) as Thread : prev);
      } else {
        setThreads((prev) => prev.map(updateThread));
      }

      // Dispatch on the request's kind to build a matching resolution
      // variant. Today only `ask_user_question` is possible; future
      // approval kinds slot in alongside without touching the callers.
      switch (request.kind) {
        case "ask_user_question":
          window.openclawdex?.resolveRequest(threadId, {
            kind: "ask_user_question",
            requestId: request.requestId,
            answers: payload.answers,
            displayText: payload.displayText,
          })?.catch((err) => reportIpcError("Submit question answer", err));
          return;
      }
    },
    [],
  );

  /**
   * Approve or reject an `exit_plan_approval` pending request. Parallel
   * to {@link handleResolveRequest}, but the payload is a single bool
   * and the user-message bubble reflects the decision (so the chat
   * transcript shows what the user chose). Dispatch lands on the
   * session's `canUseTool` Promise: approve → allow, reject → deny.
   */
  const handleApprovePlan = useCallback(
    (
      threadId: string,
      request: PendingRequest,
      approved: boolean,
      message?: string,
    ) => {
      if (request.kind !== "exit_plan_approval") return;
      const note = message?.trim();
      const userMsg: Message = {
        id: msgId(),
        role: "user",
        content: approved
          ? "Approved the plan."
          : note
            ? `Rejected the plan: ${note}`
            : "Rejected the plan.",
        timestamp: new Date(),
      };
      const updateThread = (t: Thread): Thread =>
        t.id === threadId
          ? { ...t, status: "running" as const, pendingRequest: undefined, messages: [...t.messages, userMsg] }
          : t;
      if (pendingThreadRef.current?.id === threadId) {
        setPendingThread((prev) => prev ? updateThread(prev) as Thread : prev);
      } else {
        setThreads((prev) => prev.map(updateThread));
      }
      window.openclawdex?.resolveRequest(threadId, {
        kind: "exit_plan_approval",
        requestId: request.requestId,
        approved,
        ...(note && !approved ? { message: note } : {}),
      })?.catch((err) => reportIpcError("Submit plan approval", err));
    },
    [],
  );

  /**
   * Approve / reject a single `tool_approval` pending request. Fires
   * from the inline ToolApprovalCard. Each call is independent —
   * we don't remember approvals across calls.
   */
  const handleApproveTool = useCallback(
    (
      threadId: string,
      request: PendingRequest,
      approved: boolean,
      message?: string,
    ) => {
      if (request.kind !== "tool_approval") return;
      const note = message?.trim();
      const label = approved
        ? `Approved ${request.toolName}.`
        : note
          ? `Rejected ${request.toolName}: ${note}`
          : `Rejected ${request.toolName}.`;
      const userMsg: Message = {
        id: msgId(),
        role: "user",
        content: label,
        timestamp: new Date(),
      };
      const updateThread = (t: Thread): Thread =>
        t.id === threadId
          ? { ...t, status: "running" as const, pendingRequest: undefined, messages: [...t.messages, userMsg] }
          : t;
      if (pendingThreadRef.current?.id === threadId) {
        setPendingThread((prev) => prev ? updateThread(prev) as Thread : prev);
      } else {
        setThreads((prev) => prev.map(updateThread));
      }
      window.openclawdex?.resolveRequest(threadId, {
        kind: "tool_approval",
        requestId: request.requestId,
        approved,
        ...(note && !approved ? { message: note } : {}),
      })?.catch((err) => reportIpcError("Submit tool approval", err));
    },
    [],
  );

  // Dismiss a pending request (ESC from the questionnaire composer).
  // Clears the pending state locally and tells the backend to deny the
  // paused tool call so the agent unwinds rather than hanging.
  const handleCancelRequest = useCallback(
    (threadId: string, request: PendingRequest) => {
      const updateThread = (t: Thread): Thread =>
        t.id === threadId ? { ...t, pendingRequest: undefined } : t;

      if (pendingThreadRef.current?.id === threadId) {
        setPendingThread((prev) => prev ? updateThread(prev) as Thread : prev);
      } else {
        setThreads((prev) => prev.map(updateThread));
      }

      switch (request.kind) {
        case "ask_user_question":
          window.openclawdex?.resolveRequest(threadId, {
            kind: "ask_user_question_cancel",
            requestId: request.requestId,
          })?.catch((err) => reportIpcError("Cancel question", err));
          return;
        case "exit_plan_approval":
          // Dismissing the approval card is the same as rejecting — we
          // route through the same resolution variant so the backend
          // unblocks with `behavior: "deny"` and the agent stays in
          // plan mode rather than hanging.
          window.openclawdex?.resolveRequest(threadId, {
            kind: "exit_plan_approval",
            requestId: request.requestId,
            approved: false,
          })?.catch((err) => reportIpcError("Cancel plan approval", err));
          return;
        case "tool_approval":
          window.openclawdex?.resolveRequest(threadId, {
            kind: "tool_approval",
            requestId: request.requestId,
            approved: false,
          })?.catch((err) => reportIpcError("Cancel tool approval", err));
          return;
      }
    },
    [],
  );

  // ── Interrupt handler ─────────────────────────────────────────

  const handleInterrupt = useCallback((threadId: string) => {
    window.openclawdex?.interrupt(threadId)?.catch((err) =>
      reportIpcError("Interrupt", err),
    );
  }, []);

  // ── Project rename/delete handlers ────────────────────────────

  const handleRenameProject = useCallback((projectId: string, name: string) => {
    window.openclawdex?.renameProject(projectId, name)
      .then(refreshProjects)
      .catch((err) => reportIpcError("Rename project", err));
  }, [refreshProjects]);

  const handleDeleteProject = useCallback((projectId: string) => {
    window.openclawdex?.deleteProject(projectId).then(() => {
      // Snapshot survivors/removed from the ref so the pending-thread
      // fallback below can reason about what's left without waiting
      // for a re-render.
      const survivors = threadsRef.current.filter((t) => t.projectId !== projectId);
      const removed = threadsRef.current.filter((t) => t.projectId === projectId);
      const remainingProjects = projectsRef.current.filter((p) => p.id !== projectId);

      // Keep renderer state in sync immediately so the "auto-spawn a
      // pending thread" effect sees the real post-delete project count.
      // Otherwise it can race and create a draft thread for a project
      // that was just deleted.
      setProjects(remainingProjects);
      setThreads(survivors);

      if (removed.some((t) => t.id === activeThreadIdRef.current)) {
        setActiveThreadId(null);
      }

      // Pending "new chat" drafts are only meaningful while at least
      // one project exists. When the last project disappears, clear
      // the draft unconditionally so ChatView can enter its true
      // zero-project state instead of showing an empty composer.
      const prevPending = pendingThreadRef.current;
      if (prevPending && remainingProjects.length === 0) {
        setPendingThread(null);
        if (activeThreadIdRef.current === prevPending.id) {
          setActiveThreadId(null);
        }
      } else if (prevPending && prevPending.projectId === projectId) {
        const fallback =
          [...survivors]
            .filter((t) => t.projectId)
            .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())[0]
            ?.projectId ?? null;
        if (fallback) {
          setPendingThread({ ...prevPending, projectId: fallback });
        } else {
          setPendingThread(null);
          if (activeThreadIdRef.current === prevPending.id) {
            setActiveThreadId(null);
          }
        }
      }

      refreshProjects();
    }).catch((err) => reportIpcError("Delete project", err));
  }, [refreshProjects]);

  // ── Thread rename/delete handlers ─────────────────────────────

  const handleRenameThread = useCallback((threadId: string, name: string) => {
    const thread = threadsRef.current.find((t) => t.id === threadId);
    if (!thread) return;
    const prevName = thread.name;
    setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, name } : t));
    if (thread.sessionId) {
      window.openclawdex?.renameThread(thread.sessionId, name)?.catch((err) => {
        reportIpcError("Rename thread", err);
        setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, name: prevName } : t));
      });
    }
  }, []);

  const handleDeleteThread = useCallback((threadId: string) => {
    const thread = threadsRef.current.find((t) => t.id === threadId);
    if (!thread) return;
    // Snapshot position so we can restore into the same slot on failure.
    const prevIndex = threadsRef.current.findIndex((t) => t.id === threadId);
    const wasActive = activeThreadId === threadId;
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
    if (wasActive) setActiveThreadId(null);
    if (thread.sessionId) {
      window.openclawdex?.deleteThread(thread.sessionId)?.catch((err) => {
        reportIpcError("Delete thread", err);
        setThreads((prev) => {
          if (prev.some((t) => t.id === threadId)) return prev;
          const next = [...prev];
          next.splice(Math.min(prevIndex, next.length), 0, thread);
          return next;
        });
        if (wasActive) setActiveThreadId(threadId);
      });
    }
  }, [activeThreadId]);

  const handleArchiveThread = useCallback((threadId: string) => {
    const thread = threadsRef.current.find((t) => t.id === threadId);
    if (!thread) return;
    const prevArchived = thread.archived ?? false;
    const archived = !prevArchived;
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, archived } : t)),
    );
    // Deselect if we just archived the active thread
    if (activeThreadId === threadId && archived) {
      setActiveThreadId(null);
    }
    if (thread.sessionId) {
      window.openclawdex?.archiveThread(thread.sessionId, archived)?.catch((err) => {
        reportIpcError(archived ? "Archive thread" : "Unarchive thread", err);
        setThreads((prev) =>
          prev.map((t) => (t.id === threadId ? { ...t, archived: prevArchived } : t)),
        );
      });
    }
  }, [activeThreadId]);

  const handlePinThread = useCallback((threadId: string) => {
    const thread = threadsRef.current.find((t) => t.id === threadId);
    if (!thread) return;
    const prevPinned = thread.pinned ?? false;
    const pinned = !prevPinned;
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, pinned } : t)),
    );
    if (thread.sessionId) {
      window.openclawdex?.pinThread(thread.sessionId, pinned)?.catch((err) => {
        reportIpcError(pinned ? "Pin thread" : "Unpin thread", err);
        setThreads((prev) =>
          prev.map((t) => (t.id === threadId ? { ...t, pinned: prevPinned } : t)),
        );
      });
    }
  }, []);

  /**
   * Change the thread's UserMode. Optimistic in-memory update; the
   * `mode_changed` IPC event echoed back from main.ts reconciles if
   * something goes wrong. Pending threads (no sessionId yet) get the
   * update in memory only — first send picks it up from
   * `thread.userMode` via the `userMode` opt.
   */
  const handleSetMode = useCallback((threadId: string, mode: UserMode) => {
    // Remember as the global default so new threads start in this mode.
    try {
      localStorage.setItem(USER_MODE_STORAGE_KEY, mode);
    } catch { /* localStorage full or disabled — not fatal */ }

    // Optimistic update. Covers both real threads and the pending one.
    const pending = pendingThreadRef.current;
    if (pending && pending.id === threadId) {
      setPendingThread((prev) => (prev ? { ...prev, userMode: mode } : prev));
    } else {
      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? { ...t, userMode: mode } : t)),
      );
    }

    const thread = threadsRef.current.find((t) => t.id === threadId);
    const sessionId = thread?.sessionId;
    // Only push to main for committed sessions — pending threads hold
    // the chosen mode in memory until the first send threads it through.
    if (sessionId) {
      const prevMode = thread.userMode;
      window.openclawdex?.setThreadMode(sessionId, mode)?.catch((err) => {
        reportIpcError("Change thread mode", err);
        setThreads((p) =>
          p.map((t) => (t.id === threadId ? { ...t, userMode: prevMode } : t)),
        );
      });
    }
  }, []);

  // ── Sidebar drag ──────────────────────────────────────────────

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX));
      // Bypass React — update DOM directly for smooth 60fps resize
      if (sidebarRef.current) {
        sidebarRef.current.style.width = `${w}px`;
      }
    };

    const onUp = (ev: MouseEvent) => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX));
      setSidebarWidth(w); // Commit final width to React state
      localStorage.setItem("sidebarWidth", String(w));
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  return (
    <div className="flex h-full" style={{ background: "rgba(24, 24, 24, 0.30)" }}>
      <div ref={sidebarRef} className="shrink-0" style={{ width: `${sidebarWidth}px` }}>
        <Sidebar
          threads={threads}
          projects={projects}
          activeThreadId={activeThreadId}
          onSelectThread={handleSelectThread}
          onNewThread={handleNewThread}
          onNewChat={handleNewChat}
          onCreateProject={handleCreateProject}
          onRenameProject={handleRenameProject}
          onDeleteProject={handleDeleteProject}
          onRenameThread={handleRenameThread}
          onDeleteThread={handleDeleteThread}
          onArchiveThread={handleArchiveThread}
          onPinThread={handlePinThread}
          isLoading={threadsLoading}
        />
      </div>
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
          projects={projects}
          projectCwd={projects.find((p) => p.id === activeThread?.projectId)?.folders[0]?.path}
          projectName={projects.find((p) => p.id === activeThread?.projectId)?.name}
          isLoading={threadsLoading}
          onSend={handleSend}
          onInterrupt={handleInterrupt}
          onResolveRequest={handleResolveRequest}
          onCancelRequest={handleCancelRequest}
          onApprovePlan={handleApprovePlan}
          onApproveTool={handleApproveTool}
          onUpdateThreadProvider={handleUpdateThreadProvider}
          onChangeThreadProject={handleChangeThreadProject}
          onCreateProject={handleCreateProjectBare}
          onNewChat={handleNewChat}
          onSetMode={handleSetMode}
        />
      </div>
    </div>
  );
}
