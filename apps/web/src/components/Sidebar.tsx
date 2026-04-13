import { useState } from "react";
import {
  NotePencil,
  GearSix,
  CaretDown,
  CaretRight,
  FolderOpen,
} from "@phosphor-icons/react";
import type { Thread, Provider } from "../App";
import { ScrollArea } from "./ScrollArea";

const PROVIDER_DOT: Record<Provider, string> = {
  claude: "#d97706",
  codex: "#10b981",
};

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
  activeThreadId: string;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
  width: number;
  isLoading?: boolean;
}

export function Sidebar({
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  width,
  isLoading,
}: SidebarProps) {
  const ungrouped = threads.filter((t) => !t.project);
  const grouped = threads
    .filter((t) => !!t.project)
    .reduce(
      (acc, t) => {
        const key = t.project!;
        if (!acc[key]) acc[key] = [];
        acc[key].push(t);
        return acc;
      },
      {} as Record<string, Thread[]>,
    );

  return (
    <div
      className="flex flex-col shrink-0 select-none"
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

      {/* Threads header — fixed, does not scroll */}
      <div className="shrink-0 flex items-center justify-between pl-5 pr-3 pb-2 pt-1">
        <span
          className="text-[13px] font-medium"
          style={{ color: "rgba(255, 255, 255, 0.35)" }}
        >
          Threads
        </span>
        <button
          onClick={onNewThread}
          title="New conversation"
          className="p-[4px] rounded-lg transition-colors"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.06)";
            e.currentTarget.style.color = "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
        >
          <NotePencil size={17} weight="regular" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-3 pb-2">
          {isLoading ? (
            <ThreadSkeleton />
          ) : (
            <>
              {ungrouped.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  active={thread.id === activeThreadId}
                  onSelect={onSelectThread}
                />
              ))}
              {Object.entries(grouped).map(([project, projectThreads]) => (
                <ProjectGroup
                  key={project}
                  project={project}
                  threads={projectThreads}
                  activeThreadId={activeThreadId}
                  onSelectThread={onSelectThread}
                />
              ))}
            </>
          )}
        </div>
      </ScrollArea>

      {/* Settings */}
      <div
        className="shrink-0 px-3 py-2"
      >
        <NavItem icon={<GearSix size={17} weight="regular" />} label="Settings" />
      </div>
    </div>
  );
}

function ThreadRow({
  thread,
  active,
  onSelect,
  indent = false,
}: {
  thread: Thread;
  active: boolean;
  onSelect: (id: string) => void;
  indent?: boolean;
}) {
  return (
    <button
      onClick={() => onSelect(thread.id)}
      className={`flex items-center w-full ${indent ? "pl-9" : "pl-2"} pr-2 py-[7px] mb-[2px] rounded-xl text-left transition-all duration-100`}
      style={{
        background: active ? "rgba(255,255,255,0.09)" : "transparent",
        color: active ? "var(--text-primary)" : "var(--text-secondary)",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <span className="flex-1 min-w-0 text-[13px] font-medium truncate">
        {thread.name}
      </span>
      <span
        className="text-[12px] shrink-0 ml-2 leading-none"
        style={{ color: "var(--text-muted)" }}
      >
        {timeAgo(thread.lastModified)}
      </span>
    </button>
  );
}

function ProjectGroup({
  project,
  threads,
  activeThreadId,
  onSelectThread,
}: {
  project: string;
  threads: Thread[];
  activeThreadId: string;
  onSelectThread: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="mb-1">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 w-full px-2 py-[5px] mb-[2px] rounded-xl transition-colors"
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "rgba(255,255,255,0.04)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.background = "transparent")
        }
      >
        {collapsed ? (
          <CaretRight
            size={12}
            weight="bold"
            style={{ color: "rgba(255, 255, 255, 0.6)" }}
          />
        ) : (
          <CaretDown
            size={12}
            weight="bold"
            style={{ color: "rgba(255, 255, 255, 0.6)" }}
          />
        )}
        <FolderOpen
          size={15}
          weight="regular"
          style={{ color: "rgba(255, 255, 255, 0.6)" }}
        />
        <span
          className="text-[13px] font-semibold truncate"
          style={{ color: "rgba(255, 255, 255, 0.6)" }}
        >
          {project}
        </span>
      </button>

      {!collapsed &&
        threads.map((thread) => (
          <ThreadRow
            key={thread.id}
            thread={thread}
            active={thread.id === activeThreadId}
            onSelect={onSelectThread}
            indent
          />
        ))}
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
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
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
    </button>
  );
}
