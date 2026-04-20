import { useState, useRef } from "react";
import {
  CaretDown,
  CaretRight,
  Folder,
  FolderOpen,
  DotsThree,
  PencilSimple,
  Trash,
  Plus,
  FolderPlus,
  Archive,
  PushPin,
  X,
} from "@phosphor-icons/react";
import type { Thread } from "../App";
import type { ProjectInfo } from "@openclawdex/shared";
import { ScrollArea } from "./ScrollArea";
import { DropdownSurface, DropdownItem } from "./Dropdown";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  useDndContext,
  useSensor,
  useSensors,
  closestCenter,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";

/**
 * Stable sort by `sortOrder` (asc) with `lastModified` (desc) as the
 * tiebreaker. Items with no `sortOrder` (e.g. pre-migration rows or
 * in-memory pending threads) sort after those that do — otherwise a
 * newly created thread would jump to the top of every bucket.
 */
function bySortOrder<T extends { sortOrder?: number; lastModified?: Date }>(
  a: T,
  b: T,
): number {
  const ao = a.sortOrder ?? Number.POSITIVE_INFINITY;
  const bo = b.sortOrder ?? Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;
  const al = a.lastModified?.getTime() ?? 0;
  const bl = b.lastModified?.getTime() ?? 0;
  return bl - al;
}

function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

interface SidebarProps {
  threads: Thread[];
  projects: ProjectInfo[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewThread: (projectId: string) => void;
  onNewChat: () => void;
  onCreateProject: () => void;
  onRenameProject: (projectId: string, name: string) => void;
  onDeleteProject: (projectId: string) => void;
  onRenameThread: (threadId: string, name: string) => void;
  onDeleteThread: (threadId: string) => void;
  onArchiveThread: (threadId: string) => void;
  onPinThread: (threadId: string) => void;
  /**
   * Commit a new sidebar order for projects. Receives the full ordered
   * id list (not a delta) so the parent can write it straight to the
   * backing store.
   */
  onReorderProjects: (orderedIds: string[]) => void;
  /**
   * Commit a new order for one thread bucket — pinned, a single
   * project's threads, or orphans. The sidebar only ever fires this
   * for intra-bucket drops; cross-bucket moves aren't supported yet.
   */
  onReorderThreads: (orderedIds: string[]) => void;
  isLoading?: boolean;
}

export function Sidebar({
  threads,
  projects,
  activeThreadId,
  onSelectThread,
  onNewThread,
  onNewChat,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onRenameThread,
  onDeleteThread,
  onArchiveThread,
  onPinThread,
  onReorderProjects,
  onReorderThreads,
  isLoading,
}: SidebarProps) {
  const [archivedOpen, setArchivedOpen] = useState(false);
  // Id of the currently-dragged row (thread or project). Drives the
  // DragOverlay portal so the floating preview follows the cursor 1:1
  // while the original sits hidden in its source slot.
  const [activeId, setActiveId] = useState<string | null>(null);

  // 5px activation distance means a plain click still selects the
  // thread — drag only kicks in once the user actually moves the
  // pointer. Keeps the sidebar feeling like a list, not a drag target.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Cross-bucket drags are a no-op (see handleDragEnd), so during a
  // drag we only want items in the *same* bucket as the active row to
  // react to the cursor. Without this filter, closestCenter happily
  // picks candidates from every SortableContext on screen — which
  // renders as phantom gaps opening up in unrelated lists while you
  // drag (e.g. a thread drag shifting the Projects header).
  const collisionDetection: CollisionDetection = (args) => {
    const activeBucket = args.active.data.current?.bucket as
      | string
      | undefined;
    if (!activeBucket) return closestCenter(args);
    const sameBucket = args.droppableContainers.filter(
      (c) => c.data.current?.bucket === activeBucket,
    );
    return closestCenter({ ...args, droppableContainers: sameBucket });
  };

  // Split active vs archived
  const activeThreads = threads.filter((t) => !t.archived);
  const archivedThreads = threads.filter((t) => t.archived);

  // Pinned threads (non-archived only)
  const pinnedThreads = activeThreads.filter((t) => t.pinned).slice().sort(bySortOrder);
  const unpinnedThreads = activeThreads.filter((t) => !t.pinned);

  // Threads per project (active, unpinned only — pinned ones show in their own section)
  const threadsByProject = new Map<string, Thread[]>();
  const sortedProjects = projects.slice().sort(bySortOrder);
  for (const p of sortedProjects) {
    threadsByProject.set(p.id, []);
  }
  for (const t of unpinnedThreads) {
    if (t.projectId && threadsByProject.has(t.projectId)) {
      threadsByProject.get(t.projectId)!.push(t);
    }
  }
  for (const [projectId, list] of threadsByProject) {
    threadsByProject.set(projectId, list.slice().sort(bySortOrder));
  }

  // Ungrouped threads (orphaned — project was deleted)
  const ungrouped = unpinnedThreads.filter((t) => !t.projectId).slice().sort(bySortOrder);

  // Look up the currently-dragged item so DragOverlay can render a
  // static preview that tracks the cursor. Threads and projects share
  // the same id namespace from the user's POV but not in our data —
  // so probe threads first, then projects.
  const activeThread = activeId ? threads.find((t) => t.id === activeId) ?? null : null;
  const activeProject =
    activeId && !activeThread ? projects.find((p) => p.id === activeId) ?? null : null;

  /**
   * Route a dnd-kit drop to the right reorder handler. Each sortable
   * item carries `data.bucket` — one of `"projects"`, `"pinned"`,
   * `"orphan"`, or `"project:<id>"`. We only commit intra-bucket
   * moves; cross-bucket drops are ignored (the user gets no visible
   * change, which is the least surprising outcome for v1).
   */
  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeBucket = active.data.current?.bucket as string | undefined;
    const overBucket = over.data.current?.bucket as string | undefined;
    if (!activeBucket || activeBucket !== overBucket) return;

    if (activeBucket === "projects") {
      const ids = sortedProjects.map((p) => p.id);
      const from = ids.indexOf(String(active.id));
      const to = ids.indexOf(String(over.id));
      if (from < 0 || to < 0) return;
      onReorderProjects(arrayMove(ids, from, to));
      return;
    }

    // Thread bucket — figure out which list of ids is being reordered.
    let ids: string[] | null = null;
    if (activeBucket === "pinned") {
      ids = pinnedThreads.map((t) => t.id);
    } else if (activeBucket === "orphan") {
      ids = ungrouped.map((t) => t.id);
    } else if (activeBucket.startsWith("project:")) {
      const projectId = activeBucket.slice("project:".length);
      ids = (threadsByProject.get(projectId) ?? []).map((t) => t.id);
    }
    if (!ids) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorderThreads(arrayMove(ids, from, to));
  }

  return (
    <div
      className="flex flex-col w-full h-full select-none spinner-sync"
    >
      {/* Traffic light spacer */}
      <div
        className="h-[38px] shrink-0"
        style={{
          // @ts-expect-error -- webkit
          WebkitAppRegion: "drag",
        }}
      />

      {/* Primary sidebar actions stay pinned above the scroll area, but only
          after bootstrap resolves whether projects exist. That avoids briefly
          flashing the zero-project CTA while the real project list is still
          loading. */}
      {!isLoading && (
        <div className="px-3 pt-3 pb-3 shrink-0">
          <div className="flex flex-col gap-1">
            {projects.length > 0 && (
              <button
                onClick={onNewChat}
                className="group/newthread flex items-center gap-2.5 w-full px-2 py-[6px] rounded-xl text-[13px] font-medium transition-colors"
                style={{ color: "var(--text-primary)", background: "transparent" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <span
                  className="shrink-0 flex items-center justify-center"
                  style={{ width: 17, height: 17, color: "var(--text-primary)" }}
                >
                  <Plus size={15} weight="bold" />
                </span>
                New thread
                {/* Shortcut hint — revealed on hover. Uses ⌘ on macOS-style
                    UI; the handler in App.tsx also accepts Ctrl+N for parity. */}
                <span
                  className="ml-auto text-[11px] font-medium opacity-0 group-hover/newthread:opacity-100 transition-opacity"
                  style={{ color: "rgba(255, 255, 255, 0.45)" }}
                >
                  ⌘N
                </span>
              </button>
            )}

            <button
              onClick={onCreateProject}
              className="group/newproject flex items-center gap-2.5 w-full px-2 py-[6px] rounded-xl text-[13px] font-medium transition-colors"
              style={{ color: "var(--text-primary)", background: "transparent" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <span
                className="shrink-0 flex items-center justify-center"
                style={{ width: 17, height: 17, color: "var(--text-primary)" }}
              >
                <FolderPlus size={15} weight="bold" />
              </span>
              New project
            </button>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="pb-2">
          {isLoading ? (
            <div className="px-3 pt-3">
              <ThreadSkeleton />
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetection}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setActiveId(null)}
              modifiers={[restrictToVerticalAxis]}
              // Continuous remeasurement — needed because we shrink the
              // dragged project's DOM (hiding its thread children) on
              // drag start, and the vertical list strategy has to pick
              // up the new, smaller rect to compute sibling offsets.
              measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            >
              {/* Pinned section — top-level, sibling to Projects */}
              {pinnedThreads.length > 0 && (
                <>
                  <div className="flex items-center justify-between pl-5 pr-3 pb-2 pt-2">
                    <span
                      className="text-[13px] font-medium"
                      style={{ color: "rgba(255, 255, 255, 0.35)" }}
                    >
                      Pinned
                    </span>
                  </div>
                  <div className="px-3 mb-2">
                    <SortableContext
                      items={pinnedThreads.map((t) => t.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {pinnedThreads.map((thread) => (
                        <SortableThreadRow
                          key={thread.id}
                          id={thread.id}
                          bucket="pinned"
                          thread={thread}
                          active={thread.id === activeThreadId}
                          onSelect={onSelectThread}
                          onRename={(name) => onRenameThread(thread.id, name)}
                          onDelete={() => onDeleteThread(thread.id)}
                          onArchive={() => onArchiveThread(thread.id)}
                          onPin={() => onPinThread(thread.id)}
                        />
                      ))}
                    </SortableContext>
                  </div>
                </>
              )}

              {/* Projects header — hidden in zero-project state so we don't
                  render a lone label above an empty list. */}
              {projects.length > 0 && (
                <div className="flex items-center justify-between pl-5 pr-3 pb-2 pt-2">
                  <span
                    className="text-[13px] font-medium"
                    style={{ color: "rgba(255, 255, 255, 0.35)" }}
                  >
                    Projects
                  </span>
                {/* "Add a project" button — hidden for now because the in-chat
                    project picker (ChatView) already has a "New project…"
                    entry, and the sidebar "New thread" button falls back to
                    the folder picker when no projects exist. Kept here so we
                    can restore it easily if discoverability becomes an issue. */}
                {/*
                <div className="relative group/addproj">
                  <button
                    onClick={onCreateProject}
                    className="p-[4px] rounded-lg transition-colors"
                    style={{ color: "rgba(255,255,255,0.5)" }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                      e.currentTarget.style.color = "var(--text-primary)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "rgba(255,255,255,0.5)";
                    }}
                  >
                    <FolderPlus size={17} weight="regular" />
                  </button>
                  <div
                    className="absolute right-full top-1/2 -translate-y-1/2 mr-1.5 px-2.5 py-1.5 rounded-lg text-[12px] whitespace-nowrap opacity-0 group-hover/addproj:opacity-100 transition-opacity duration-150 pointer-events-none z-50"
                    style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--border-emphasis)" }}
                  >
                    Add a project
                  </div>
                </div>
                */}
                </div>
              )}

              <div className="px-3">
              {/* Project groups */}
              <SortableContext
                items={sortedProjects.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
              >
                {sortedProjects.map((project) => {
                  const projectThreads = threadsByProject.get(project.id) ?? [];
                  return (
                    <SortableProjectGroup
                      key={project.id}
                      project={project}
                      threads={projectThreads}
                      activeThreadId={activeThreadId}
                      onSelectThread={onSelectThread}
                      onNewThread={() => onNewThread(project.id)}
                      onRename={(name) => onRenameProject(project.id, name)}
                      onDelete={() => onDeleteProject(project.id)}
                      onRenameThread={onRenameThread}
                      onDeleteThread={onDeleteThread}
                      onArchiveThread={onArchiveThread}
                      onPinThread={onPinThread}
                    />
                  );
                })}
              </SortableContext>

              {/* Ungrouped threads (orphans) */}
              <SortableContext
                items={ungrouped.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                {ungrouped.map((thread) => (
                  <SortableThreadRow
                    key={thread.id}
                    id={thread.id}
                    bucket="orphan"
                    thread={thread}
                    active={thread.id === activeThreadId}
                    onSelect={onSelectThread}
                    onRename={(name) => onRenameThread(thread.id, name)}
                    onDelete={() => onDeleteThread(thread.id)}
                    onArchive={() => onArchiveThread(thread.id)}
                    onPin={() => onPinThread(thread.id)}
                  />
                ))}
              </SortableContext>

              </div>

              {/* Portal-rendered phantom that follows the cursor 1:1. The
                  source row is hidden (opacity 0) while dragging, so the
                  user only ever sees this preview — no magnet-to-slot. */}
              <DragOverlay dropAnimation={null}>
                {activeThread ? (
                  <div style={{ cursor: "grabbing" }}>
                    <ThreadRow
                      thread={activeThread}
                      active={false}
                      onSelect={() => {}}
                      onRename={() => {}}
                      onDelete={() => {}}
                      onArchive={() => {}}
                    />
                  </div>
                ) : activeProject ? (
                  <div
                    className="flex items-center w-full px-2 py-[5px] rounded-xl"
                    style={{
                      background: "rgba(255,255,255,0.06)",
                      cursor: "grabbing",
                    }}
                  >
                    <span
                      className="shrink-0 flex items-center justify-center"
                      style={{ width: 16, height: 16, marginRight: 6 }}
                    >
                      <Folder
                        size={16}
                        weight="regular"
                        style={{ color: "rgba(255, 255, 255, 0.6)" }}
                      />
                    </span>
                    <span
                      className="text-[13px] font-semibold truncate"
                      style={{ color: "rgba(255, 255, 255, 0.6)" }}
                    >
                      {activeProject.name}
                    </span>
                  </div>
                ) : null}
              </DragOverlay>

            </DndContext>
          )}
        </div>
      </ScrollArea>

      {/* Archived pinned to bottom */}
      <div className="shrink-0 px-3 py-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <NavItem
          icon={<Archive size={17} weight="regular" />}
          label="Archived"
          badge={archivedThreads.length > 0 ? archivedThreads.length : undefined}
          onClick={() => setArchivedOpen(true)}
        />
      </div>

      {/* Archived threads modal */}
      {archivedOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setArchivedOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.5)" }} />

          {/* Panel */}
          <div
            className="relative z-10 flex flex-col rounded-2xl"
            style={{
              width: "min(440px, calc(100vw - 80px))",
              height: "min(520px, calc(100vh - 120px))",
              background: "#1c1c1c",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.06)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <div className="flex items-center gap-2">
                <Archive size={16} weight="regular" style={{ color: "rgba(255,255,255,0.5)" }} />
                <span className="text-[14px] font-semibold" style={{ color: "rgba(255,255,255,0.9)" }}>
                  Archived threads
                </span>
                <span
                  className="text-[12px] px-1.5 py-[1px] rounded-md"
                  style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.06)" }}
                >
                  {archivedThreads.length}
                </span>
              </div>
              <button
                onClick={() => setArchivedOpen(false)}
                className="p-1 rounded-lg transition-colors"
                style={{ color: "rgba(255,255,255,0.4)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                  e.currentTarget.style.color = "rgba(255,255,255,0.8)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "rgba(255,255,255,0.4)";
                }}
              >
                <X size={16} weight="bold" />
              </button>
            </div>

            {/* Thread list */}
            {archivedThreads.length > 0 ? (
              <ScrollArea className="flex-1">
                <div className="px-3 pb-3">
                  {archivedThreads.map((thread) => (
                    <ThreadRow
                      key={thread.id}
                      thread={thread}
                      active={thread.id === activeThreadId}
                      onSelect={(id) => {
                        onSelectThread(id);
                        setArchivedOpen(false);
                      }}
                      onRename={(name) => onRenameThread(thread.id, name)}
                      onDelete={() => onDeleteThread(thread.id)}
                      onArchive={() => onArchiveThread(thread.id)}
                    />
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="flex-1 flex items-center justify-center pb-12">
                <span className="text-[13px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                  No archived threads
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ThreadStatusIndicator({ thread, onPin }: { thread: Thread; onPin?: () => void }) {
  let dot: React.ReactNode = null;

  if (thread.status === "running") {
    dot = <span className="thread-spinner block" />;
  } else if (thread.status === "awaiting_input") {
    dot = (
      <span
        className="block rounded-full"
        style={{
          width: 7,
          height: 7,
          background: "#f5bf4f",
          boxShadow: "0 0 4px rgba(245, 191, 79, 0.4)",
        }}
      />
    );
  } else if (thread.needsAttention) {
    dot = (
      <span
        className="block rounded-full"
        style={{
          width: 7,
          height: 7,
          background: "rgba(255, 255, 255, 0.85)",
          boxShadow: "0 0 4px rgba(255, 255, 255, 0.3)",
        }}
      />
    );
  }

  if (!onPin) {
    return (
      <span className="shrink-0 flex items-center justify-center ml-1 mr-2" style={{ width: 14 }}>
        {dot}
      </span>
    );
  }

  return (
    <span
      className="shrink-0 relative flex items-center justify-center ml-1 mr-2"
      style={{ width: 14, height: 14 }}
    >
      <span className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity">
        {dot}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPin();
        }}
        title={thread.pinned ? "Unpin" : "Pin to top"}
        className="absolute flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        style={{
          width: 20,
          height: 20,
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          color: "rgba(255,255,255,0.55)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "rgba(255,255,255,1)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "rgba(255,255,255,0.55)";
        }}
      >
        <PushPin size={15} weight="regular" />
      </button>
    </span>
  );
}

function ThreadRow({
  thread,
  active,
  onSelect,
  onRename,
  onDelete,
  onArchive,
  onPin,
}: {
  thread: Thread;
  active: boolean;
  onSelect: (id: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onArchive: () => void;
  onPin?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(thread.name);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  function handleRenameSubmit() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== thread.name) {
      onRename(trimmed);
    } else {
      setRenameValue(thread.name);
    }
    setRenaming(false);
  }

  return (
    <div
      className="group relative flex items-center w-full pl-1 pr-2 py-[7px] mb-[2px] rounded-xl text-left transition-all duration-100"
      style={{
        background: active ? "rgba(255,255,255,0.09)" : "transparent",
        // Inactive threads sit at 0.92 (not --text-secondary/0.75) so they
        // read clearly brighter than project headers (0.6) — otherwise the
        // two levels blend into a single muted tier.
        color: active ? "var(--text-primary)" : "rgba(255,255,255,0.92)",
      }}
      onClick={() => {
        if (!renaming) onSelect(thread.id);
      }}
      onMouseEnter={(e) => {
        if (!active && !menuOpen) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
      }}
      onMouseLeave={(e) => {
        if (!active && !menuOpen) e.currentTarget.style.background = "transparent";
      }}
    >
      {thread.archived ? <span className="w-2 shrink-0" /> : <ThreadStatusIndicator thread={thread} onPin={onPin} />}
      {renaming ? (
        <input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={handleRenameSubmit}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRenameSubmit();
            if (e.key === "Escape") {
              setRenameValue(thread.name);
              setRenaming(false);
            }
          }}
          className="flex-1 min-w-0 text-[13px] font-medium bg-transparent outline-none border-b"
          style={{ color: "rgba(255,255,255,0.9)", borderColor: "rgba(255,255,255,0.3)" }}
          autoFocus
        />
      ) : (
        <span
          className="flex-1 min-w-0 text-[13px] font-medium truncate text-left"
        >
          {thread.name}
        </span>
      )}

      {!renaming && (
        <>
          <span
            className="text-[12px] shrink-0 ml-2 leading-none group-hover:opacity-0 transition-opacity"
            style={{ color: "var(--text-muted)" }}
          >
            {timeAgo(thread.lastModified)}
          </span>
          <div className="absolute right-2 inset-y-0 flex items-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              ref={menuBtnRef}
              onClick={(e) => {
                e.stopPropagation();
                if (!menuOpen && menuBtnRef.current) {
                  const rect = menuBtnRef.current.getBoundingClientRect();
                  setMenuPos({ top: rect.bottom + 4, left: rect.left });
                }
                setMenuOpen((v) => !v);
              }}
              className="p-[2px] rounded-md transition-opacity opacity-60 hover:opacity-100"
              style={{ color: "rgba(255,255,255,1)" }}
            >
              <DotsThree size={18} weight="bold" />
            </button>

            {menuOpen && menuPos && (
              <>
                <div className="fixed inset-0 z-[60]" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} />
                <DropdownSurface
                  variant="floating"
                  className="fixed z-[70]"
                  style={{
                    top: menuPos.top,
                    left: menuPos.left,
                    minWidth: "160px",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <DropdownItem
                    variant="floating"
                    onClick={() => {
                      setMenuOpen(false);
                      setRenaming(true);
                      setRenameValue(thread.name);
                    }}
                  >
                    <PencilSimple size={16} weight="regular" />
                    Rename
                  </DropdownItem>
                  {onPin && (
                    <DropdownItem
                      variant="floating"
                      onClick={() => {
                        setMenuOpen(false);
                        onPin();
                      }}
                    >
                      {/* Outline glyph in both states — the label carries the
                          state ("Pin" vs "Unpin"); a filled glyph was
                          overloading the signal and reading as "active". */}
                      <PushPin size={15} weight="regular" />
                      {thread.pinned ? "Unpin" : "Pin to top"}
                    </DropdownItem>
                  )}
                  <DropdownItem
                    variant="floating"
                    onClick={() => {
                      setMenuOpen(false);
                      onArchive();
                    }}
                  >
                    <Archive size={15} weight="regular" />
                    {thread.archived ? "Unarchive" : "Archive"}
                  </DropdownItem>
                  <DropdownItem
                    variant="floating"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                  >
                    <Trash size={14} weight="regular" />
                    Delete
                  </DropdownItem>
                </DropdownSurface>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ProjectGroup({
  project,
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  onRename,
  onDelete,
  onRenameThread,
  onDeleteThread,
  onArchiveThread,
  onPinThread,
  isDragging,
}: {
  project: ProjectInfo;
  threads: Thread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onRenameThread: (threadId: string, name: string) => void;
  onDeleteThread: (threadId: string) => void;
  onArchiveThread: (threadId: string) => void;
  onPinThread: (threadId: string) => void;
  /**
   * True only when THIS project is being dragged — not when one of its
   * threads is. Hides the expanded thread list so the sortable wrapper
   * measures as a single header-sized row (see SortableProjectGroup).
   */
  isDragging?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(`project:collapsed:${project.id}`) === "true"
  );

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    if (next) {
      localStorage.setItem(`project:collapsed:${project.id}`, "true");
    } else {
      localStorage.removeItem(`project:collapsed:${project.id}`);
    }
  }
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(project.name);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  function handleRenameSubmit() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== project.name) {
      onRename(trimmed);
    } else {
      setRenameValue(project.name);
    }
    setRenaming(false);
  }

  return (
    <div className="mb-1">
      <div
        className="group flex items-center w-full px-2 py-[5px] mb-[2px] rounded-xl transition-colors"
        onClick={() => {
          if (!renaming) toggleCollapsed();
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "rgba(255,255,255,0.04)")
        }
        onMouseLeave={(e) => {
          if (!menuOpen) e.currentTarget.style.background = "transparent";
        }}
      >
        {/* Collapse toggle + name */}
        <div
          className="flex items-center gap-1.5 flex-1 min-w-0"
        >
          <span
            className="shrink-0 relative flex items-center justify-center"
            style={{ width: 16, height: 16, cursor: "pointer" }}
          >
            {/* Folder at rest — fades out on row hover/focus */}
            <span
              className="absolute inset-0 flex items-center justify-center transition-opacity opacity-100 group-hover:opacity-0 group-focus-within:opacity-0"
              aria-hidden
            >
              {collapsed ? (
                <Folder
                  size={16}
                  weight="regular"
                  style={{ color: "rgba(255, 255, 255, 0.6)" }}
                />
              ) : (
                <FolderOpen
                  size={16}
                  weight="regular"
                  style={{ color: "rgba(255, 255, 255, 0.6)" }}
                />
              )}
            </span>
            {/* Chevron on hover/focus — communicates the expand affordance */}
            <span
              className="absolute inset-0 flex items-center justify-center transition-opacity opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
              aria-hidden
            >
              {collapsed ? (
                <CaretRight
                  size={12}
                  weight="bold"
                  style={{ color: "rgba(255, 255, 255, 0.75)" }}
                />
              ) : (
                <CaretDown
                  size={12}
                  weight="bold"
                  style={{ color: "rgba(255, 255, 255, 0.75)" }}
                />
              )}
            </span>
          </span>
          {renaming ? (
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameSubmit();
                if (e.key === "Escape") {
                  setRenameValue(project.name);
                  setRenaming(false);
                }
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 text-[13px] font-semibold bg-transparent outline-none border-b"
              style={{
                color: "rgba(255, 255, 255, 0.9)",
                borderColor: "rgba(255,255,255,0.3)",
              }}
              autoFocus
            />
          ) : (
            <span
              className="text-[13px] font-semibold truncate"
              style={{ color: "rgba(255, 255, 255, 0.6)" }}
            >
              {project.name}
            </span>
          )}
        </div>

        {/* Context menu button — shown on hover */}
        <div className="relative shrink-0 flex items-center">
          <button
            ref={menuBtnRef}
            onClick={(e) => {
              e.stopPropagation();
              if (!menuOpen && menuBtnRef.current) {
                const rect = menuBtnRef.current.getBoundingClientRect();
                setMenuPos({ top: rect.bottom + 4, left: rect.left });
              }
              setMenuOpen((v) => !v);
            }}
            className="p-[3px] rounded-md opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
            style={{ color: "rgba(255,255,255,1)" }}
          >
            <DotsThree size={18} weight="bold" />
          </button>

          {menuOpen && menuPos && (
            <>
              <div
                className="fixed inset-0 z-[60]"
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }}
              />
              <DropdownSurface
                variant="floating"
                className="fixed z-[70]"
                style={{
                  top: menuPos.top,
                  left: menuPos.left,
                  minWidth: "160px",
                }}
              >
                <DropdownItem
                  variant="floating"
                  onClick={() => {
                    setMenuOpen(false);
                    setRenaming(true);
                    setRenameValue(project.name);
                  }}
                >
                  <PencilSimple size={16} weight="regular" />
                  Rename
                </DropdownItem>
                <DropdownItem
                  variant="floating"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                >
                  <Trash size={16} weight="regular" />
                  Delete project
                </DropdownItem>
              </DropdownSurface>
            </>
          )}
        </div>

        {/* New thread button — shown on hover */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNewThread();
          }}
          title="New thread"
          className="p-[3px] rounded-md opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
          style={{ color: "rgba(255,255,255,1)" }}
        >
          <Plus size={14} weight="bold" />
        </button>
      </div>

      {!collapsed && !isDragging && (
        threads.length > 0 ? (
          <SortableContext
            items={threads.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {threads.map((thread) => (
              <SortableThreadRow
                key={thread.id}
                id={thread.id}
                bucket={`project:${project.id}`}
                thread={thread}
                active={thread.id === activeThreadId}
                onSelect={onSelectThread}
                onRename={(name) => onRenameThread(thread.id, name)}
                onDelete={() => onDeleteThread(thread.id)}
                onArchive={() => onArchiveThread(thread.id)}
                onPin={() => onPinThread(thread.id)}
              />
            ))}
          </SortableContext>
        ) : (
          <button
            onClick={onNewThread}
            className="flex items-center gap-2 w-full pl-9 pr-2 py-[7px] rounded-xl text-[13px] transition-colors"
            style={{ color: "rgba(255,255,255,0.4)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Plus size={14} weight="bold" />
            New thread
          </button>
        )
      )}
    </div>
  );
}

/**
 * Drag-aware wrapper around {@link ThreadRow}. `bucket` identifies the
 * SortableContext this row belongs to so the top-level drag-end handler
 * can tell a pinned-list drop from a per-project-list drop without
 * having to consult all three lists.
 *
 * GOTCHA: `PointerSensor.activationConstraint.distance` prevents a
 * simple click on the row (or its menu button) from firing a drag, so
 * we can safely spread the drag listeners on the wrapper rather than
 * carving out a dedicated drag handle.
 */
function SortableThreadRow({
  id,
  bucket,
  ...rowProps
}: {
  id: string;
  bucket: string;
} & React.ComponentProps<typeof ThreadRow>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
    isOver,
    activeIndex,
    index,
  } = useSortable({ id, data: { bucket } });
  const wrapperStyle: React.CSSProperties = {
    // GOTCHA: use `Translate.toString` (not `Transform.toString`) so we
    // emit `translate3d(…)` only. The `Transform` variant can append
    // `scaleX/scaleY` which dnd-kit occasionally sets to animate the
    // gap-fill — and those scales visibly squashed the row icons.
    transform: CSS.Translate.toString(transform),
    position: "relative",
    cursor: "grab",
    touchAction: "none",
    width: "100%",
  };
  // Hide the source row's pixels while dragging — the DragOverlay
  // renders the visible phantom. Keep opacity on an inner div (not the
  // wrapper) so the drop-line sibling stays visible when the cursor
  // hovers back over the source slot.
  const contentStyle: React.CSSProperties = { opacity: isDragging ? 0 : 1 };
  // Drop-target indicator. When hovering a different row, outline goes
  // in the gap on the side the active is approaching from. When
  // hovering back over the source itself, outline fills the source
  // slot as a "drop = stay here" signal.
  const hasActive = activeIndex !== -1;
  const showAbove =
    isOver && hasActive && !isDragging && activeIndex > index;
  const showBelow =
    isOver && hasActive && !isDragging && activeIndex < index;
  const showSelf = isOver && isDragging;
  return (
    <div ref={setNodeRef} style={wrapperStyle} {...attributes} {...listeners}>
      {showAbove && <DropOutline variant="above" />}
      {showSelf && <DropOutline variant="self" />}
      <div style={contentStyle}>
        <ThreadRow {...rowProps} />
      </div>
      {showBelow && <DropOutline variant="below" />}
    </div>
  );
}

/**
 * Drag-aware wrapper around {@link ProjectGroup}. The listeners go on
 * the header container inside ProjectGroup via a shared inner div —
 * we keep the collapse toggle and new-thread button clickable thanks
 * to the 5px pointer-sensor threshold.
 */
function SortableProjectGroup(props: React.ComponentProps<typeof ProjectGroup>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
    isOver,
    activeIndex,
    index,
  } = useSortable({ id: props.project.id, data: { bucket: "projects" } });
  const wrapperStyle: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    position: "relative",
    cursor: "grab",
    touchAction: "none",
    width: "100%",
  };
  const contentStyle: React.CSSProperties = { opacity: isDragging ? 0 : 1 };
  const hasActive = activeIndex !== -1;
  const showAbove =
    isOver && hasActive && !isDragging && activeIndex > index;
  const showBelow =
    isOver && hasActive && !isDragging && activeIndex < index;
  const showSelf = isOver && isDragging;
  return (
    <div ref={setNodeRef} style={wrapperStyle} {...attributes} {...listeners}>
      {showAbove && <DropOutline variant="above" />}
      {showSelf && <DropOutline variant="self" />}
      <div style={contentStyle}>
        {/* While this project is the active drag, collapse its footprint
            to just the header by telling ProjectGroup to skip the thread
            children. Combined with MeasuringStrategy.Always on DndContext,
            the source slot shrinks to one row so siblings only shift by
            a header's worth of height instead of the whole expanded tree. */}
        <ProjectGroup {...props} isDragging={isDragging} />
      </div>
      {showBelow && <DropOutline variant="below" />}
    </div>
  );
}

/**
 * Dashed outline marking the drop target area.
 *
 * - `"above"`: gap sits above this row (active was below, dragging up).
 *              Outline is anchored to the row's top, extending upward
 *              by one active-row height so it fills the opened gap.
 * - `"below"`: gap sits below this row. Outline extends downward.
 * - `"self"`:  cursor is back over the source's own slot. Outline
 *              fills the wrapper (whose inner content is opacity 0 and
 *              whose height already matches the reserved slot).
 */
function DropOutline({ variant }: { variant: "above" | "below" | "self" }) {
  const { active } = useDndContext();
  const h = active?.rect.current.initial?.height ?? 0;

  let pos: React.CSSProperties;
  if (variant === "self") {
    pos = { top: 0, bottom: 0 };
  } else if (h <= 0) {
    // Active's rect hasn't been measured yet — bail rather than render
    // a zero-height ghost box.
    return null;
  } else if (variant === "above") {
    pos = { top: -h, height: h };
  } else {
    pos = { bottom: -h, height: h };
  }

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: 6,
        right: 6,
        border: "1px dashed rgba(255, 255, 255, 0.22)",
        borderRadius: 10,
        pointerEvents: "none",
        zIndex: 2,
        ...pos,
      }}
    />
  );
}

const SKELETON_GROUPS: { labelWidth: string; rows: string[] }[] = [
  { labelWidth: "55%", rows: ["100%", "90%", "95%"] },
  { labelWidth: "45%", rows: ["100%", "85%"] },
];

function ThreadSkeleton() {
  return (
    <div className="animate-pulse">
      {SKELETON_GROUPS.map((group, gi) => (
        <div key={gi} className="mb-1">
          <div className="flex items-center gap-1.5 px-2 py-[5px] mb-[2px]">
            <div className="w-3 h-3 rounded-sm" style={{ background: "rgba(255,255,255,0.08)" }} />
            <div className="h-[18px] rounded-lg" style={{ width: group.labelWidth, background: "rgba(255,255,255,0.08)" }} />
          </div>
          {group.rows.map((w, ri) => (
            <div key={ri} className="flex items-center pl-9 pr-2 py-[7px] mb-[2px]">
              <div className="h-[22px] rounded-xl" style={{ width: w, background: "rgba(255,255,255,0.06)" }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function NavItem({
  icon,
  label,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 w-full px-2 py-[6px] rounded-xl text-[13px] font-medium transition-colors"
      style={{ color: "var(--text-primary)" }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "rgba(255,255,255,0.05)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.background = "transparent")
      }
    >
      <span style={{ color: "var(--text-primary)" }}>{icon}</span>
      {label}
      {badge != null && (
        <span className="ml-auto text-[11px]" style={{ color: "rgba(255,255,255,0.25)" }}>
          {badge}
        </span>
      )}
    </button>
  );
}
