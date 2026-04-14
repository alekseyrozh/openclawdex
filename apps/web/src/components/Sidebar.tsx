import { useState, useRef } from "react";
import {
  GearSix,
  CaretDown,
  CaretRight,
  FolderOpen,
  DotsThree,
  PencilSimple,
  Trash,
  Plus,
  FolderPlus,
  Archive,
  X,
} from "@phosphor-icons/react";
import type { Thread } from "../App";
import type { ProjectInfo } from "@openclawdex/shared";
import { ScrollArea } from "./ScrollArea";

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
  onCreateProject: () => void;
  onRenameProject: (projectId: string, name: string) => void;
  onDeleteProject: (projectId: string) => void;
  onRenameThread: (threadId: string, name: string) => void;
  onDeleteThread: (threadId: string) => void;
  onArchiveThread: (threadId: string) => void;
  width: number;
  isLoading?: boolean;
}

export function Sidebar({
  threads,
  projects,
  activeThreadId,
  onSelectThread,
  onNewThread,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onRenameThread,
  onDeleteThread,
  onArchiveThread,
  width,
  isLoading,
}: SidebarProps) {
  const [archivedOpen, setArchivedOpen] = useState(false);

  // Split active vs archived
  const activeThreads = threads.filter((t) => !t.archived);
  const archivedThreads = threads.filter((t) => t.archived);

  // Threads per project (active only)
  const threadsByProject = new Map<string, Thread[]>();
  for (const p of projects) {
    threadsByProject.set(p.id, []);
  }
  for (const t of activeThreads) {
    if (t.projectId && threadsByProject.has(t.projectId)) {
      threadsByProject.get(t.projectId)!.push(t);
    }
  }

  // Ungrouped threads (orphaned — project was deleted)
  const ungrouped = activeThreads.filter((t) => !t.projectId);

  return (
    <div
      className="flex flex-col shrink-0 select-none spinner-sync"
      style={{
        width: `${width}px`,
        background: "rgba(24, 24, 24, 0.30)",
      }}
    >
      {/* Traffic light spacer */}
      <div
        className="h-[38px] shrink-0"
        style={{
          // @ts-expect-error -- webkit
          WebkitAppRegion: "drag",
        }}
      />

      {/* Header */}
      <div className="shrink-0 flex items-center justify-between pl-5 pr-3 pb-2 pt-1">
        <span
          className="text-[13px] font-medium"
          style={{ color: "rgba(255, 255, 255, 0.35)" }}
        >
          Projects
        </span>
        <button
          onClick={onCreateProject}
          title="New project"
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
      </div>

      <ScrollArea className="flex-1">
        <div className="px-3 pb-2">
          {isLoading ? (
            <ThreadSkeleton />
          ) : (
            <>
              {/* Project groups */}
              {projects.map((project) => {
                const projectThreads = threadsByProject.get(project.id) ?? [];
                return (
                  <ProjectGroup
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
                  />
                );
              })}

              {/* Ungrouped threads (orphans) */}
              {ungrouped.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  active={thread.id === activeThreadId}
                  onSelect={onSelectThread}
                  onRename={(name) => onRenameThread(thread.id, name)}
                  onDelete={() => onDeleteThread(thread.id)}
                  onArchive={() => onArchiveThread(thread.id)}
                />
              ))}

              {/* Empty state */}
              {projects.length === 0 && ungrouped.length === 0 && !isLoading && (
                <button
                  onClick={onCreateProject}
                  className="flex items-center gap-2 w-full px-2 py-3 rounded-xl text-[13px] transition-colors"
                  style={{ color: "rgba(255,255,255,0.4)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <FolderPlus size={16} weight="regular" />
                  Add a project
                </button>
              )}

            </>
          )}
        </div>
      </ScrollArea>

      {/* Archived + Settings pinned to bottom */}
      <div className="shrink-0 px-3 py-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        {archivedThreads.length > 0 && (
          <NavItem
            icon={<Archive size={17} weight="regular" />}
            label="Archived"
            badge={archivedThreads.length}
            onClick={() => setArchivedOpen(true)}
          />
        )}
        <NavItem icon={<GearSix size={17} weight="regular" />} label="Settings" />
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
              maxHeight: "min(520px, calc(100vh - 120px))",
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
            <div className="flex-1 overflow-y-auto px-3 pb-3">
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
          </div>
        </div>
      )}
    </div>
  );
}

function ThreadStatusIndicator({ thread }: { thread: Thread }) {
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

  return (
    <span className="shrink-0 flex items-center justify-center ml-1 mr-2" style={{ width: 14 }}>
      {dot}
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
  indent = false,
}: {
  thread: Thread;
  active: boolean;
  onSelect: (id: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onArchive: () => void;
  indent?: boolean;
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
      className={`group relative flex items-center w-full ${indent ? "pl-2" : "pl-1"} pr-2 py-[7px] mb-[2px] rounded-xl text-left transition-all duration-100`}
      style={{
        background: active ? "rgba(255,255,255,0.09)" : "transparent",
        color: active ? "var(--text-primary)" : "var(--text-secondary)",
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
      <ThreadStatusIndicator thread={thread} />
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
                <div
                  className="fixed z-[70] rounded-2xl overflow-hidden p-1.5"
                  style={{
                    top: menuPos.top,
                    left: menuPos.left,
                    background: "rgba(32,32,32,0.98)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    boxShadow: "0 8px 30px rgba(0,0,0,0.55), 0 0 0 0.5px rgba(255,255,255,0.06)",
                    minWidth: "160px",
                    backdropFilter: "blur(20px)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setRenaming(true);
                      setRenameValue(thread.name);
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-[8px] text-[13px] text-left rounded-lg transition-colors"
                    style={{ color: "rgba(255,255,255,0.85)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <PencilSimple size={16} weight="regular" />
                    Rename
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onArchive();
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-[8px] text-[13px] text-left rounded-lg transition-colors"
                    style={{ color: "rgba(255,255,255,0.85)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <Archive size={15} weight="regular" />
                    {thread.archived ? "Unarchive" : "Archive"}
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-[8px] text-[13px] text-left rounded-lg transition-colors"
                    style={{ color: "rgba(255,255,255,0.85)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <Trash size={14} weight="regular" />
                    Delete
                  </button>
                </div>
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
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(project.name);
  const menuRef = useRef<HTMLDivElement>(null);
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
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "rgba(255,255,255,0.04)")
        }
        onMouseLeave={(e) => {
          if (!menuOpen) e.currentTarget.style.background = "transparent";
        }}
      >
        {/* Collapse toggle + name */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1.5 flex-1 min-w-0"
        >
          {collapsed ? (
            <CaretRight
              size={12}
              weight="bold"
              style={{ color: "rgba(255, 255, 255, 0.6)", flexShrink: 0 }}
            />
          ) : (
            <CaretDown
              size={12}
              weight="bold"
              style={{ color: "rgba(255, 255, 255, 0.6)", flexShrink: 0 }}
            />
          )}
          <FolderOpen
            size={15}
            weight="regular"
            style={{ color: "rgba(255, 255, 255, 0.6)", flexShrink: 0, marginLeft: 8 }}
          />
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
        </button>

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
                onClick={() => setMenuOpen(false)}
              />
              <div
                ref={menuRef}
                className="fixed z-[70] rounded-2xl overflow-hidden p-1.5"
                style={{
                  top: menuPos.top,
                  left: menuPos.left,
                  background: "rgba(32,32,32,0.98)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  boxShadow: "0 8px 30px rgba(0,0,0,0.55), 0 0 0 0.5px rgba(255,255,255,0.06)",
                  minWidth: "160px",
                  backdropFilter: "blur(20px)",
                }}
              >
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setRenaming(true);
                    setRenameValue(project.name);
                  }}
                  className="flex items-center gap-2.5 w-full px-3 py-[8px] text-[13px] text-left rounded-lg transition-colors"
                  style={{ color: "rgba(255,255,255,0.85)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <PencilSimple size={16} weight="regular" />
                  Rename
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                  className="flex items-center gap-2.5 w-full px-3 py-[8px] text-[13px] text-left rounded-lg transition-colors"
                  style={{ color: "rgba(255,255,255,0.85)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <Trash size={16} weight="regular" />
                  Delete project
                </button>
              </div>
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

      {!collapsed && (
        threads.length > 0 ? (
          threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              active={thread.id === activeThreadId}
              onSelect={onSelectThread}
              onRename={(name) => onRenameThread(thread.id, name)}
              onDelete={() => onDeleteThread(thread.id)}
              onArchive={() => onArchiveThread(thread.id)}
              indent
            />
          ))
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
