import { useState } from "react";
import {
  NotePencil,
  GearSix,
  CaretDown,
  CaretRight,
  FolderOpen,
} from "@phosphor-icons/react";
import type { Thread, Provider } from "../App";

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
  width: number;
}

export function Sidebar({
  threads,
  activeThreadId,
  onSelectThread,
  width,
}: SidebarProps) {
  const grouped = threads.reduce(
    (acc, t) => {
      const key = t.project ?? "Ungrouped";
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

      {/* Threads section */}
      <div className="flex-1 overflow-y-auto px-3 pt-2 pb-2">
        <div className="flex items-center justify-between px-2 pb-2">
          <span
            className="text-[13px] font-medium"
            style={{ color: "rgba(255, 255, 255, 0.35)" }}
          >
            Threads
          </span>
          <button
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

        {Object.entries(grouped).map(([project, projectThreads]) => (
          <ProjectGroup
            key={project}
            project={project}
            threads={projectThreads}
            activeThreadId={activeThreadId}
            onSelectThread={onSelectThread}
          />
        ))}
      </div>

      {/* Settings */}
      <div
        className="shrink-0 px-3 py-2"
      >
        <NavItem icon={<GearSix size={17} weight="regular" />} label="Settings" />
      </div>
    </div>
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
        threads.map((thread) => {
          const active = thread.id === activeThreadId;
          return (
            <button
              key={thread.id}
              onClick={() => onSelectThread(thread.id)}
              className="flex items-center w-full pl-9 pr-2 py-[7px] mb-[2px] rounded-xl text-left transition-all duration-100"
              style={{
                background: active
                  ? "rgba(255,255,255,0.09)"
                  : "transparent",
                color: active
                  ? "var(--text-primary)"
                  : "var(--text-secondary)",
              }}
              onMouseEnter={(e) => {
                if (!active)
                  e.currentTarget.style.background = "rgba(255,255,255,0.04)";
              }}
              onMouseLeave={(e) => {
                if (!active)
                  e.currentTarget.style.background = "transparent";
              }}
            >
              <span className="flex-1 min-w-0 text-[13px] font-medium truncate">
                {thread.name}
              </span>
              <span
                className="text-[12px] shrink-0 ml-2 leading-none"
                style={{ color: "var(--text-muted)" }}
              >
                {timeAgo(thread.messages[0]?.timestamp ?? new Date())}
              </span>
            </button>
          );
        })}
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
