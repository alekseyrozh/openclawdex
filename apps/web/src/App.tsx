import { useState, useCallback, useRef, useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import type { ImagePayload } from "./components/ChatView";
import { IpcEvent, SessionInfo, HistoryMessage, ProjectInfo, ContextStats, type Provider, type PendingRequest, type UserMode, type ThreadsReorderBucket } from "@openclawdex/shared";
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
   * from `localStorage.lastUserMode`, falling back to `acceptEdits`.
   */
  userMode: UserMode;
  historyLoaded?: boolean;
  lastModified: Date;
  contextStats?: ContextStats;
  /**
   * Epoch ms the thread was archived. Single source of truth for
   * archive state: present = archived, undefined = active. Drives the
   * archive list's sort order (most-recent-first).
   */
  archivedAt?: number;
  pinned?: boolean;
  needsAttention?: boolean;
  /**
   * Sidebar sort index within this thread's HOME bucket (per-project
   * or orphan). Persisted on the backing DB row; optional because
   * pre-migration threads and freshly-created (not-yet-inserted)
   * pending threads don't carry one. The renderer sorts by `sortOrder`
   * asc with `lastModified` desc as the tiebreaker.
   *
   * NOT used for pinned ordering — the pinned section sorts by
   * `pinSortOrder` instead, so unpinning restores this value untouched.
   */
  sortOrder?: number;
  /**
   * Sidebar sort index within the PINNED bucket. Non-null iff `pinned`
   * is true. Stamped to `-Date.now()` by the pin handler so new pins
   * float to the top; cleared on unpin so a later re-pin stamps a
   * fresh value. Kept separate from `sortOrder` so the two axes don't
   * interfere.
   */
  pinSortOrder?: number | null;
  /**
   * The open pause-for-input request, if any. Set when the backend
   * emits a `pending_request` IPC event and cleared the moment the
   * user submits a resolution. `request.kind` drives which renderer
   * (e.g. QuestionCard for `ask_user_question`) handles the input.
   */
  pendingRequest?: PendingRequest;
  /**
   * Renderer-side scheduling state for follow-up prompts submitted
   * while the agent is already running.
   */
  queueState: QueueState;
  /**
   * Present while the upstream CLI reports that the user has hit
   * their usage cap. Cleared when the SDK reports the state
   * returning to `allowed` (via a `rate_limit_clear` event) or when
   * the user dispatches a new turn (optimistic — the next turn will
   * re-emit a notice if the limit is still in force). The renderer
   * displays a banner above the composer with the reset time.
   */
  rateLimitNotice?: RateLimitNotice;
}

export interface RateLimitNotice {
  /** Epoch ms at which usage resets; null when the SDK didn't provide one. */
  resetAtMs: number | null;
  /**
   * `true` when the overage bucket is the blocker (both primary and
   * overage rejected). `false` when only the primary bucket is
   * rejected. Surfaced so the banner copy can differentiate.
   */
  overage: boolean;
}

export interface QueuedMessage {
  /** Stable id so the UI can target delete/reorder without index math. */
  id: string;
  text: string;
  images?: ImagePayload[];
  /** Captured at enqueue time — a queued message preserves the
   *  model / effort the user had selected when they typed it, even if
   *  they flip the dropdowns before the queue drains. */
  model?: string;
  effort?: string;
  createdAt: number;
}

export interface QueueState {
  /**
   * Follow-up prompts captured while a thread was busy. They preserve
   * the model/effort chosen at submit time and are delivered FIFO.
   */
  items: QueuedMessage[];
  /**
   * Delivery policy for the next terminal turn boundary.
   *
   * `normal`:
   *   a clean `idle` may auto-drain the next queued item.
   * `skip_next_idle`:
   *   skip exactly one clean `idle` drain, then reset to `normal`.
   *   Used after interrupt so the aborted turn doesn't immediately
   *   relaunch the backlog.
   */
  drainMode: "normal" | "skip_next_idle";
}

export interface MessageImage {
  url: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool_use" | "plan";
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
  /**
   * Path to a file that contains the full plan text. Carried on `plan`
   * messages so the read-only history card can offer an "Open in editor"
   * button, matching the live ExitPlanMode approval UI.
   */
  planFilePath?: string;
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

function newQueueState(): QueueState {
  return {
    items: [],
    drainMode: "normal",
  };
}

function enqueueQueuedMessage(thread: Thread, message: QueuedMessage): Thread {
  return {
    ...thread,
    queueState: {
      ...thread.queueState,
      items: [...thread.queueState.items, message],
    },
  };
}

function removeQueuedMessage(thread: Thread, queuedId: string): Thread {
  return {
    ...thread,
    queueState: {
      ...thread.queueState,
      items: thread.queueState.items.filter((q) => q.id !== queuedId),
    },
  };
}

function skipNextQueueDrain(thread: Thread): Thread {
  return {
    ...thread,
    queueState: {
      ...thread.queueState,
      drainMode: "skip_next_idle",
    },
  };
}

/**
 * Decide what happens to the queue at a terminal turn boundary.
 *
 * Returns only the new `queueState` (not a full Thread). The caller
 * applies it with `updateThreadState` on top of the *current* thread,
 * which is critical: this runs synchronously after `applyIpcEvent` has
 * already scheduled `status: idle` / `error` for the same event, and
 * `getThreadSnapshot` reads from a ref that hasn't caught up yet.
 * Returning a whole Thread and replacing it would clobber the freshly
 * applied status and leave the UI stuck "running" (Thinking…) forever.
 */
function settleQueueAfterTerminalStatus(
  thread: Thread,
  status: Thread["status"],
): {
  queueState: QueueState;
  next?: QueuedMessage;
} {
  if (status !== "idle") {
    return { queueState: thread.queueState };
  }
  if (thread.queueState.drainMode === "skip_next_idle") {
    return {
      queueState: { ...thread.queueState, drainMode: "normal" },
    };
  }
  if (thread.queueState.items.length === 0) {
    return { queueState: thread.queueState };
  }
  const [next, ...rest] = thread.queueState.items;
  return {
    queueState: { ...thread.queueState, items: rest },
    next,
  };
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

/**
 * Tool names that represent a non-privileged file edit. When the user
 * switches to `acceptEdits` while a tool_approval is pending for one
 * of these, we auto-approve since the new mode would have allowed it.
 * Matches the Claude canUseTool gate (edit-family tools pass in
 * acceptEdits) plus Codex's `apply_patch` (file change approval RPC).
 */
const FILE_EDIT_TOOL_NAMES = new Set([
  "Edit",
  "Write",
  "NotebookEdit",
  "apply_patch",
]);

function lastSavedUserMode(): UserMode {
  try {
    const raw = localStorage.getItem(USER_MODE_STORAGE_KEY);
    if (raw && (USER_MODES as readonly string[]).includes(raw)) {
      return raw as UserMode;
    }
  } catch {}
  return "acceptEdits";
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
    queueState: newQueueState(),
    // Negative epoch puts new threads above everything: older rows
    // backfilled to positive `createdAt`, and reordered buckets using
    // dense `0..N-1`. Preserved by the DB insert in main.ts so the
    // order doesn't flip when the pending thread becomes persisted.
    sortOrder: -Date.now(),
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
    archivedAt: s.archivedAt,
    pinned: s.pinned ?? false,
    sortOrder: s.sortOrder,
    pinSortOrder: s.pinSortOrder ?? null,
    userMode: s.userMode ?? "acceptEdits",
    queueState: newQueueState(),
  };
}

function historyToMessages(items: HistoryMessage[]): Message[] {
  return items.map((h) => {
    if (h.role === "tool_use") {
      return { id: h.id, role: "tool_use" as const, content: "", timestamp: new Date(), toolName: h.toolName, toolInput: h.toolInput };
    }
    if (h.role === "plan") {
      return {
        id: h.id,
        role: "plan" as const,
        content: h.content,
        timestamp: new Date(),
        ...(h.planFilePath && { planFilePath: h.planFilePath }),
      };
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
    case "plan_card": {
      const planMsg: Message = {
        id: msgId(),
        role: "plan",
        content: event.plan,
        timestamp: new Date(),
      };
      return { ...thread, messages: [...thread.messages, planMsg] };
    }
    case "rate_limit_notice": {
      return {
        ...thread,
        rateLimitNotice: {
          resetAtMs: event.resetAtMs,
          overage: event.overage,
        },
      };
    }
    case "rate_limit_clear": {
      if (!thread.rateLimitNotice) return thread;
      const { rateLimitNotice: _drop, ...rest } = thread;
      return rest;
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

  /**
   * Queue-drain hook into the IPC listener: the listener's useEffect
   * runs once with `[]` deps, but needs to call the *current*
   * `dispatchSend` callback. We point a ref at it and sync below.
   */
  const dispatchSendRef = useRef<
    | ((
        threadId: string,
        text: string,
        images?: ImagePayload[],
        opts?: { model?: string; effort?: string },
      ) => void)
    | null
  >(null);
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

  const updateThreadState = useCallback(
    (threadId: string, updater: (thread: Thread) => Thread) => {
      const pending = pendingThreadRef.current;
      if (pending && pending.id === threadId) {
        setPendingThread((prev) => (prev ? updater(prev) : prev));
        return;
      }
      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? updater(t) : t)),
      );
    },
    [],
  );

  const getThreadSnapshot = useCallback((threadId: string): Thread | undefined => {
    const pending = pendingThreadRef.current;
    return (pending && pending.id === threadId)
      ? pending
      : threadsRef.current.find((t) => t.id === threadId);
  }, []);

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

      // Agent turn ended — it may have run `git checkout` / `git switch`
      // / `git worktree` as part of its work, so re-check the branch.
      // Error states count too: a crash after a `git checkout` still
      // leaves the working copy on the new branch.
      if (event.type === "status" && (event.status === "idle" || event.status === "error")) {
        refreshGitBranchRef.current?.(event.threadId);
        const target = getThreadSnapshot(event.threadId);
        if (!target) return;
        const { queueState, next } = settleQueueAfterTerminalStatus(target, event.status);
        // Merge only the queueState back. A whole-thread replacement here
        // would clobber the status update from the `setThreads` above,
        // which was scheduled but hasn't committed yet — `target` still
        // has the pre-event status ("running"), so a snapshot-based copy
        // would drag it back and the "Thinking…" indicator would stick.
        updateThreadState(event.threadId, (thread) => ({ ...thread, queueState }));
        if (!next) return;
        // Defer the actual dispatch to a microtask so the queue-state
        // update and the status reducers settle before dispatchSend
        // flips status back to "running".
        Promise.resolve().then(() => {
          dispatchSendRef.current?.(event.threadId, next.text, next.images, {
            ...(next.model && { model: next.model }),
            ...(next.effort && { effort: next.effort }),
          });
        });
      }
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

  // ── Resolve git branch for a thread ──────────────────────────
  //
  // Re-fetches on:
  //   - thread switch (activeThreadId changes)
  //   - clicking the active thread in the sidebar (via handleSelectThread)
  //   - window regains focus (user may have run `git checkout` externally)
  //
  // The underlying `git symbolic-ref` is effectively free, so we don't
  // cache or conditionalize on "already have a branch" — the whole
  // point is to catch branch changes the UI can't otherwise observe.
  //
  // Implemented as a ref-reading useCallback so both the effect and
  // handleSelectThread can invoke it without the refresher participating
  // in any dependency array (which would re-fire the effect and
  // re-attach the focus listener on unrelated renders).

  const refreshGitBranch = useCallback((threadId: string) => {
    const getBranch = window.openclawdex?.getGitBranch;
    if (!getBranch) return;
    const thread =
      (pendingThreadRef.current?.id === threadId ? pendingThreadRef.current : undefined) ??
      threadsRef.current.find((t) => t.id === threadId);
    if (!thread) return;
    const cwd = projectsRef.current.find((p) => p.id === thread.projectId)?.folders[0]?.path;
    if (!cwd) return;

    getBranch(cwd).then((branch) => {
      if (!branch) return;
      // No "is this still active?" guard — we update by threadId, and
      // each thread's cwd is stable, so the result is always correct
      // for the thread we queried. Updating background threads is
      // desirable: if an agent runs `git checkout` in a thread we're
      // not currently viewing, we still want its label to be correct
      // when we switch back.
      setPendingThread((prev) => prev && prev.id === threadId ? { ...prev, branch } : prev);
      setThreads((prev) => prev.map((t) => t.id === threadId && t.branch !== branch ? { ...t, branch } : t));
    }).catch((err) => {
      // Branch label is purely cosmetic — don't alert.
      logIpcError("Resolve git branch", err);
    });
  }, []);

  // Ref so the IPC subscription effect (deps: []) can always reach
  // the current refresher without participating in its deps.
  const refreshGitBranchRef = useRef(refreshGitBranch);
  refreshGitBranchRef.current = refreshGitBranch;

  // Fetch on thread switch + whenever the window regains focus.
  // Scalar dep (activeThreadId only) so unrelated state updates don't
  // re-attach the focus listener.
  useEffect(() => {
    if (!activeThreadId) return;
    refreshGitBranch(activeThreadId);
    const onFocus = () => {
      const id = activeThreadIdRef.current;
      if (id) refreshGitBranch(id);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [activeThreadId, refreshGitBranch]);

  // ── Send message handler ──────────────────────────────────────

  /**
   * Dispatches a user message straight through to the backend. This is
   * the "actually talk to the CLI now" path — both the direct send
   * (thread is idle) and the queue-drain (thread just went idle)
   * funnel through here.
   *
   * Callers are responsible for checking whether the thread is busy;
   * this function assumes it's safe to send right now.
   */
  const dispatchSend = useCallback(
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
        // First message on pending thread — update it, send with provider/model/effort.
        // Clear any stale rate-limit banner optimistically: if the
        // limit is still in force, the backend will re-emit
        // `rate_limit_notice` within this turn. Otherwise it
        // disappears the moment the user retries, which matches
        // intuition.
        const name = text.length > 40 ? text.slice(0, 40) + "…" : text;
        setPendingThread((prev) => prev ? { ...prev, name, status: "running", messages: [userMsg], rateLimitNotice: undefined, ...(opts?.model && { model: opts.model }), ...(opts?.effort && { effort: opts.effort }) } : prev);
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
            // Clear stale rate-limit banner — mirror logic in the
            // pending-thread branch above.
            return { ...t, status: "running" as const, messages: [...t.messages, userMsg], rateLimitNotice: undefined, ...(opts?.model && { model: opts.model }), ...(opts?.effort && { effort: opts.effort }) };
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

  // Keep the IPC-listener-facing ref pointed at the current callback.
  // `dispatchSend` has `[]` deps so its identity is stable in practice,
  // but assigning on every render is cheap and bulletproof.
  dispatchSendRef.current = dispatchSend;

  /**
   * Top-level send from the composer. Branches:
   *   - thread is idle        → dispatch immediately
   *   - thread is running     → enqueue for later delivery
   *   - thread is awaiting_input or error → dispatch (the pending-request
   *     UI has already intercepted composer text via its own approval
   *     path; anything reaching here is a plain follow-up. Error state
   *     lets the user retry by sending.)
   *
   * Queued messages live in `thread.queueState.items`; the main
   * process sees nothing until the scheduler decides to dispatch.
   */
  const handleSend = useCallback(
    (threadId: string, text: string, images?: ImagePayload[], opts?: { model?: string; effort?: string }) => {
      const target = getThreadSnapshot(threadId);
      const isRunning = target?.status === "running";

      if (!isRunning) {
        dispatchSend(threadId, text, images, opts);
        return;
      }

      const queued: QueuedMessage = {
        id: msgId(),
        text,
        ...(images && images.length > 0 && { images }),
        ...(opts?.model && { model: opts.model }),
        ...(opts?.effort && { effort: opts.effort }),
        createdAt: Date.now(),
      };

      updateThreadState(threadId, (thread) => enqueueQueuedMessage(thread, queued));
    },
    [dispatchSend, getThreadSnapshot, updateThreadState],
  );

  /**
   * Remove a message from a thread's queue. No IPC — queued messages
   * never reached the backend, so deleting is pure renderer state.
   */
  const handleDeleteQueuedMessage = useCallback(
    (threadId: string, queuedId: string) => {
      updateThreadState(threadId, (thread) => removeQueuedMessage(thread, queuedId));
    },
    [updateThreadState],
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
    // Re-check git branch — if this was already the active thread the
    // effect below wouldn't refire, but the user clicking in is a
    // natural "I'm paying attention to this now" signal.
    refreshGitBranch(id);
  }, [refreshGitBranch]);

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
      // Persist the plan in the transcript so it doesn't disappear
      // when the approval card is dismissed. Matches what history
      // replay shows (a read-only plan card) — the collapsed form is
      // chosen inside PlanApprovalCard when rendered with `readOnly`.
      const planMsg: Message = {
        id: msgId(),
        role: "plan",
        content: request.plan,
        timestamp: new Date(),
      };
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
          ? { ...t, status: "running" as const, pendingRequest: undefined, messages: [...t.messages, planMsg, userMsg] }
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
    updateThreadState(threadId, skipNextQueueDrain);
    window.openclawdex?.interrupt(threadId)?.catch((err) =>
      reportIpcError("Interrupt", err),
    );
  }, [updateThreadState]);

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
    const prevArchivedAt = thread.archivedAt;
    const archived = prevArchivedAt == null;
    // `archivedAt` is the single source of truth — non-null means
    // archived, undefined means active. Optimistic update mirrors the
    // backend write in main.ts so the sidebar reorders immediately.
    const archivedAt = archived ? Date.now() : undefined;
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, archivedAt } : t)),
    );
    // Deselect if we just archived the active thread
    if (activeThreadId === threadId && archived) {
      setActiveThreadId(null);
    }
    if (thread.sessionId) {
      window.openclawdex?.archiveThread(thread.sessionId, archived)?.catch((err) => {
        reportIpcError(archived ? "Archive thread" : "Unarchive thread", err);
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId ? { ...t, archivedAt: prevArchivedAt } : t,
          ),
        );
      });
    }
  }, [activeThreadId]);

  const handlePinThread = useCallback((threadId: string) => {
    const thread = threadsRef.current.find((t) => t.id === threadId);
    if (!thread) return;
    const prevPinned = thread.pinned ?? false;
    const prevPinSortOrder = thread.pinSortOrder ?? null;
    const pinned = !prevPinned;
    // Optimistic update mirrors the main-side contract:
    //   pin   → stamp pinSortOrder = -Date.now() (floats to top of pins)
    //   unpin → clear pinSortOrder back to null
    // `sortOrder` (home-bucket position) is never touched — that's the
    // whole point of the two-column split: unpinning drops the row
    // back into its home bucket at the exact slot it used to occupy.
    const nextPinSortOrder = pinned ? -Date.now() : null;
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId ? { ...t, pinned, pinSortOrder: nextPinSortOrder } : t,
      ),
    );
    if (thread.sessionId) {
      window.openclawdex?.pinThread(thread.sessionId, pinned)?.catch((err) => {
        reportIpcError(pinned ? "Pin thread" : "Unpin thread", err);
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId
              ? { ...t, pinned: prevPinned, pinSortOrder: prevPinSortOrder }
              : t,
          ),
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
    const pendingThread = pendingThreadRef.current;
    if (pendingThread && pendingThread.id === threadId) {
      setPendingThread((prev) => (prev ? { ...prev, userMode: mode } : prev));
    } else {
      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? { ...t, userMode: mode } : t)),
      );
    }

    const thread = threadsRef.current.find((t) => t.id === threadId)
      ?? (pendingThread?.id === threadId ? pendingThread : undefined);
    // GOTCHA: pass `thread.id` (the UI-generated id), NOT
    // `thread.sessionId` (Claude CLI's session id). The main process
    // `sessions` Map is keyed by the UI id — that's what `session:send`
    // and `interrupt` use. Earlier code passed sessionId here, and
    // `sessions.get(sessionId)` returned undefined, so setMode
    // silently no-op'd and mode flips never reached the session.
    const prevMode = thread?.userMode ?? mode;
    window.openclawdex?.setThreadMode(threadId, mode)?.catch((err) => {
      reportIpcError("Change thread mode", err);
      setThreads((p) =>
        p.map((t) => (t.id === threadId ? { ...t, userMode: prevMode } : t)),
      );
    });

    // If a tool_approval is pending and the new mode would have allowed
    // that tool automatically, auto-approve so the user doesn't have to
    // click twice. Mirrors the canUseTool gate logic for Claude; Codex
    // approvals match on apply_patch for file-change RPCs.
    const pendingReq = thread?.pendingRequest;
    if (pendingReq?.kind === "tool_approval") {
      const autoAllow =
        mode === "bypassPermissions" ||
        (mode === "acceptEdits" && FILE_EDIT_TOOL_NAMES.has(pendingReq.toolName));
      if (autoAllow) {
        handleApproveTool(threadId, pendingReq, true);
      }
    }
  }, [handleApproveTool]);

  /**
   * Persist a new sidebar order for projects. The renderer already
   * re-sorted its local `projects` state optimistically; this flushes
   * that order to the DB so it survives reloads. On failure we roll
   * back by re-reading from the main process.
   */
  const handleReorderProjects = useCallback((orderedIds: string[]) => {
    setProjects((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      const next: ProjectInfo[] = orderedIds.flatMap((id, i) => {
        const p = byId.get(id);
        return p ? [{ ...p, sortOrder: i }] : [];
      });
      // Append any projects not in the reorder set (shouldn't happen
      // today, but keeps the list whole if the caller sends a partial
      // order by mistake).
      const missing = prev.filter((p) => !orderedIds.includes(p.id));
      return [...next, ...missing];
    });
    window.openclawdex?.reorderProjects?.(orderedIds)?.catch((err) => {
      reportIpcError("Reorder projects", err);
      refreshProjects();
    });
  }, [refreshProjects]);

  /**
   * Persist a new sidebar order for threads within one bucket.
   *
   * `bucket` is "pinned" for the pinned section or "home" for a
   * per-project list / orphans — the main process uses it to decide
   * which sort column to write (pin_sort_order vs sort_order). The
   * two axes are independent so unpinning restores the home-bucket
   * slot untouched.
   *
   * Only session-backed threads are passed through to IPC — a freshly-
   * dragged pending thread has no DB row yet, so its order is
   * client-side only until first send.
   */
  const handleReorderThreads = useCallback(
    (bucket: ThreadsReorderBucket, orderedIds: string[]) => {
      setThreads((prev) => {
        const byId = new Map(prev.map((t) => [t.id, t]));
        const reordered: Thread[] = orderedIds.flatMap((id, i) => {
          const t = byId.get(id);
          if (!t) return [];
          return [
            bucket === "pinned"
              ? { ...t, pinSortOrder: i }
              : { ...t, sortOrder: i },
          ];
        });
        const untouched = prev.filter((t) => !orderedIds.includes(t.id));
        return [...reordered, ...untouched];
      });
      const sessionIds = orderedIds
        .map((id) => threadsRef.current.find((t) => t.id === id)?.sessionId)
        .filter((s): s is string => typeof s === "string" && s.length > 0);
      if (sessionIds.length === 0) return;
      window.openclawdex?.reorderThreads?.(bucket, sessionIds)?.catch((err) => {
        reportIpcError("Reorder threads", err);
      });
    },
    [],
  );

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
          onReorderProjects={handleReorderProjects}
          onReorderThreads={handleReorderThreads}
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
          onDeleteQueuedMessage={handleDeleteQueuedMessage}
        />
      </div>
    </div>
  );
}
