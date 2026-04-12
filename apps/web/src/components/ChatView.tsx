import { useState, useRef, useEffect, useCallback } from "react";
import { ScrollArea, type ScrollAreaHandle } from "./ScrollArea";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  ArrowDown,
  Stop,
  CaretDown,
  Check,
  ArrowCounterClockwise,
  FileText,
  Monitor,
  GitBranch,
  Copy,
} from "@phosphor-icons/react";
import type { Thread, Message, FileChange } from "../App";

/* ── Claude sparkle icon ────────────────────────────────────── */

function ClaudeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 248 248" fill="currentColor" className={className}>
      <path d="M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z" />
    </svg>
  );
}

/* ── Model definitions ──────────────────────────────────────── */

interface ModelDef {
  id: string;
  label: string;
  subtitle: string;
}

const CLAUDE_MODELS: ModelDef[] = [
  { id: "opus", label: "Claude Opus 4.6", subtitle: "Most capable" },
  { id: "sonnet", label: "Claude Sonnet 4.6", subtitle: "Fast & capable" },
  { id: "haiku", label: "Claude Haiku 4.5", subtitle: "Fastest" },
];

/* ── Effort levels ──────────────────────────────────────────── */

interface EffortDef {
  id: string;
  label: string;
  subtitle: string;
}

const EFFORT_LEVELS: EffortDef[] = [
  { id: "max", label: "Max", subtitle: "Extended thinking, highest quality" },
  { id: "high", label: "High", subtitle: "Thorough reasoning" },
  { id: "medium", label: "Medium", subtitle: "Balanced speed and quality" },
  { id: "low", label: "Low", subtitle: "Fast, minimal reasoning" },
];

/* ── Modes ──────────────────────────────────────────────────── */

interface ModeDef {
  id: string;
  label: string;
  subtitle: string;
}

const MODES: ModeDef[] = [
  { id: "ask", label: "Ask before edits", subtitle: "Confirm each file change before applying" },
  { id: "auto", label: "Auto-accept edits", subtitle: "Apply changes without asking" },
  { id: "plan", label: "Plan mode", subtitle: "Outline a plan without making changes" },
];

/* ── File change card ────────────────────────────────────────── */

function FileChangeCard({ changes }: { changes: FileChange[] }) {
  const total = changes.length;
  return (
    <div
      className="rounded-2xl overflow-hidden my-3"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border-emphasis)",
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-[6px]"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <span className="text-[13px] font-medium" style={{ color: "var(--text-secondary)" }}>
          {total} file{total > 1 ? "s" : ""} changed
        </span>
        <button
          className="flex items-center gap-1 text-[13px] font-medium transition-colors"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.color = "var(--text-primary)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.color = "var(--text-muted)")
          }
        >
          <ArrowCounterClockwise size={12} weight="regular" />
          Undo
        </button>
      </div>
      {changes.map((fc, i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-3 py-[7px] transition-colors"
          style={{ cursor: "default" }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "rgba(255,255,255,0.02)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          <FileText size={13} weight="regular" style={{ color: "var(--text-faint)" }} />
          <span
            className="flex-1 text-[13px] font-mono font-medium truncate"
            style={{ color: "var(--text-secondary)" }}
          >
            {fc.path}
          </span>
          <span
            className="text-[13px] font-mono font-medium"
            style={{ color: "var(--diff-added)" }}
          >
            +{fc.additions}
          </span>
          <span
            className="text-[13px] font-mono font-medium"
            style={{ color: "var(--diff-removed)" }}
          >
            −{fc.deletions}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Collapsed messages ──────────────────────────────────────── */

function CollapsedIndicator({ count }: { count: number }) {
  return (
    <div className="flex items-center justify-center py-3">
      <button
        className="flex items-center gap-1 text-[13px] font-medium px-3 py-[4px] rounded-full transition-colors"
        style={{
          color: "rgba(255, 255, 255, 0.60)",
          border: "1px solid var(--border-default)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--surface-2)";
          e.currentTarget.style.color = "rgba(255,255,255,0.60)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-muted)";
        }}
      >
        <CaretDown size={12} weight="bold" />
        {count} previous messages
      </button>
    </div>
  );
}

/* ── Thinking indicator ──────────────────────────────────────── */

function ThinkingIndicator() {
  return (
    <div
      className="thinking-shimmer flex items-center gap-2 text-[14px] font-medium"
      style={{ color: "rgba(255,255,255,0.60)" }}
    >
      Thinking…
    </div>
  );
}

/* ── Streaming text with fade-in ─────────────────────────────── */

/**
 * Renders streaming text where each word fades in individually.
 * Splits incoming chunks into words, each mounted as a separate span
 * with a staggered animation delay.
 */
function StreamingText({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  // Each entry: { token, key, delay, settled }
  const tokens = useRef<{ token: string; key: number; delay: number; settled: boolean }[]>([]);
  const prevLength = useRef(0);
  const nextKey = useRef(0);

  if (isStreaming && text.length > prevLength.current) {
    // Settle all previous tokens immediately
    for (const t of tokens.current) {
      t.settled = true;
    }

    const fresh = text.slice(prevLength.current);
    const parts = fresh.split(/(\s+)/);
    let wordIndex = 0;
    for (const part of parts) {
      if (!part) continue;
      const isWord = !/^\s+$/.test(part);
      tokens.current.push({
        token: part,
        key: nextKey.current++,
        delay: isWord ? wordIndex * 30 : 0,
        settled: false,
      });
      if (isWord) wordIndex++;
    }
    prevLength.current = text.length;
  }

  if (!isStreaming) {
    tokens.current = [];
    prevLength.current = 0;
    nextKey.current = 0;
    return <MarkdownContent text={text} />;
  }

  return (
    <>
      {tokens.current.map(({ token, key, delay, settled }) =>
        /^\s+$/.test(token) ? (
          <span key={key}>{token}</span>
        ) : settled ? (
          <span key={key}>{token}</span>
        ) : (
          <span
            key={key}
            className="token-new"
            style={{ animationDelay: `${delay}ms` }}
          >
            {token}
          </span>
        ),
      )}
    </>
  );
}

/* ── Message block ───────────────────────────────────────────── */

function MessageHoverBar({ message, reverse }: { message: Message; reverse?: boolean }) {
  const [copied, setCopied] = useState(false);

  const timeStr = message.timestamp.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  function handleCopy() {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div
      className={`flex items-center mt-3${reverse ? " flex-row-reverse gap-3" : " gap-2"}`}
      style={{ color: "rgba(255,255,255,0.60)" }}
    >
      <button
        onClick={handleCopy}
        className="flex items-center rounded-lg p-1 -m-1 transition-colors"
        style={{ color: "rgba(255,255,255,0.60)", lineHeight: 1 }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--text-primary)";
          e.currentTarget.style.background = "var(--surface-3)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "rgba(255,255,255,0.60)";
          e.currentTarget.style.background = "transparent";
        }}
        title="Copy message"
      >
        {copied ? <Check size={15} weight="bold" /> : <Copy size={15} weight="regular" />}
      </button>
      <span className="text-[12px] font-medium" style={{ lineHeight: 1, color: "rgba(255,255,255,0.60)" }}>{timeStr}</span>
    </div>
  );
}

/* ── Tool use indicator ──────────────────────────────────────── */

function ToolUseIndicator({ toolName }: { toolName: string }) {
  return (
    <div
      className="py-2 px-1 text-[13px] font-medium"
      style={{ color: "var(--text-muted)" }}
    >
      {toolName}
    </div>
  );
}

function MessageBlock({ message, isStreaming, showHoverBar }: { message: Message; isStreaming: boolean; showHoverBar: boolean }) {
  if (message.collapsed) {
    return <CollapsedIndicator count={message.collapsed} />;
  }

  if (message.role === "tool_use") {
    return <ToolUseIndicator toolName={message.toolName ?? "unknown"} />;
  }

  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="my-3 ml-auto w-fit max-w-[85%] min-w-0 group">
        <div
          className="rounded-2xl px-5 py-3.5 text-[14px] leading-[1.6] font-medium break-words"
          style={{
            background: "var(--surface-3)",
            color: "var(--text-primary)",
          }}
        >
          {message.content}
        </div>
        {showHoverBar && (
          <div className="flex justify-end px-2 transition-opacity duration-300 opacity-0 group-hover:opacity-100">
            <MessageHoverBar message={message} reverse />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="py-4 px-1 group">
      <div
        className="text-[14px] leading-[1.65] font-medium break-words min-w-0"
        style={{ color: "var(--text-primary)" }}
      >
        <StreamingText text={message.content} isStreaming={isStreaming} />
      </div>
      {message.fileChanges && message.fileChanges.length > 0 && (
        <FileChangeCard changes={message.fileChanges} />
      )}
      {showHoverBar && (
        <div className="px-2 transition-opacity duration-300 opacity-0 group-hover:opacity-100">
          <MessageHoverBar message={message} />
        </div>
      )}
    </div>
  );
}

function MarkdownContent({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p className="mb-3 last:mb-0">{children}</p>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold" style={{ color: "var(--text-primary)" }}>{children}</strong>
        ),
        em: ({ children }) => (
          <em className="italic">{children}</em>
        ),
        h1: ({ children }) => (
          <h1 className="text-[17px] font-semibold mt-4 mb-2 first:mt-0" style={{ color: "var(--text-primary)" }}>{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-[15px] font-semibold mt-4 mb-2 first:mt-0" style={{ color: "var(--text-primary)" }}>{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-[14px] font-semibold mt-3 mb-1.5 first:mt-0" style={{ color: "var(--text-primary)" }}>{children}</h3>
        ),
        ul: ({ children }) => (
          <ul className="mb-3 last:mb-0 pl-5 space-y-1 list-disc">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-3 last:mb-0 pl-5 space-y-1 list-decimal">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="leading-[1.65]">{children}</li>
        ),
        code: ({ children, className }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <code
                className="block font-mono text-[12px] font-medium px-3 py-2.5 rounded-xl overflow-x-auto"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {children}
              </code>
            );
          }
          const inner = String(children);
          const isFileRef = inner.includes("/") || inner.includes("(line");
          if (isFileRef) {
            return (
              <code className="font-mono text-[12.5px] font-semibold" style={{ color: "#6DC6FF" }}>
                {inner}
              </code>
            );
          }
          return (
            <code
              className="font-mono text-[12.5px] font-medium px-[5px] py-[2px] rounded-md"
              style={{
                background: "rgba(255,255,255,0.07)",
                color: "var(--text-primary)",
              }}
            >
              {inner}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="mb-3 last:mb-0">{children}</pre>
        ),
        blockquote: ({ children }) => (
          <blockquote
            className="pl-3 my-2 italic"
            style={{
              borderLeft: "2px solid var(--border-emphasis)",
              color: "rgba(255,255,255,0.60)",
            }}
          >
            {children}
          </blockquote>
        ),
        hr: () => (
          <hr className="my-3" style={{ borderColor: "var(--border-subtle)" }} />
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

/* ── Textarea with custom scrollbar ─────────────────────────── */

function TextareaWithScrollbar({
  textareaRef,
  value,
  onChange,
  onKeyDown,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
}) {
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(null);
  const [scrolling, setScrolling] = useState(false);
  const [hovered, setHovered] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateThumb = useCallback((el: HTMLTextAreaElement) => {
    const maxH = 140;
    if (el.scrollHeight <= maxH) { setThumb(null); return; }
    const ratio = maxH / el.scrollHeight;
    const height = Math.max(ratio * maxH, 24);
    const top = (el.scrollTop / el.scrollHeight) * maxH;
    setThumb({ height, top });
  }, []);

  const onScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    updateThumb(e.currentTarget);
    setScrolling(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setScrolling(false), 1000);
  }, [updateThumb]);

  const onThumbMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const el = textareaRef.current;
    if (!el || !thumb) return;
    const startY = e.clientY;
    const startScrollTop = el.scrollTop;
    const maxH = 140;
    const thumbRange = maxH - thumb.height;
    const scrollRange = el.scrollHeight - maxH;
    const onMove = (ev: MouseEvent) => {
      el.scrollTop = startScrollTop + ((ev.clientY - startY) / thumbRange) * scrollRange;
      updateThumb(el);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [textareaRef, thumb, updateThumb]);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={onChange}
        onScroll={onScroll}
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = el.scrollHeight + "px";
          el.style.overflowY = el.scrollHeight > 140 ? "auto" : "hidden";
          updateThumb(el);
        }}
        onKeyDown={onKeyDown}
        placeholder="Ask for follow-up changes"
        rows={1}
        className="w-full bg-transparent text-[14px] font-medium px-4 pt-3 pb-1 resize-none outline-none placeholder:text-[var(--text-faint)] hide-native-scrollbar"
        style={{
          color: "var(--text-primary)",
          minHeight: "36px",
          maxHeight: "140px",
          overflowY: "hidden",
          scrollbarWidth: "none",
        } as React.CSSProperties}
      />
      {thumb && (
        <div
          className="absolute right-1 rounded-full cursor-pointer transition-opacity duration-300 pointer-events-auto"
          style={{
            top: thumb.top + 4,
            height: thumb.height - 8,
            width: 8,
            background: hovered ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.14)",
            borderRadius: 100,
            opacity: scrolling || hovered ? 1 : 0,
          }}
          onMouseDown={onThumbMouseDown}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        />
      )}
    </div>
  );
}

/* ── Chat view ───────────────────────────────────────────────── */

interface ChatViewProps {
  thread: Thread | null;
  onSend: (threadId: string, text: string) => void;
  onInterrupt: (threadId: string) => void;
}

export function ChatView({ thread, onSend, onInterrupt }: ChatViewProps) {
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState(CLAUDE_MODELS[0]);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const [selectedEffort, setSelectedEffort] = useState(EFFORT_LEVELS[1]); // default "high"
  const [effortDropdownOpen, setEffortDropdownOpen] = useState(false);
  const effortDropdownRef = useRef<HTMLDivElement>(null);
  const [selectedMode, setSelectedMode] = useState(MODES[0]); // default "Ask before edits"
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const modeDropdownRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<ScrollAreaHandle>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const isAtBottomRef = useRef(true);

  const handleMessagesScroll = useCallback((el: HTMLDivElement) => {
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    isAtBottomRef.current = atBottom;
    setShowScrollBtn(!atBottom);
  }, []);

  // Auto-scroll to bottom when messages change (only if already at bottom)
  useEffect(() => {
    if (isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [thread?.messages]);

  // Autofocus composer when thread changes
  useEffect(() => {
    if (thread?.id) {
      textareaRef.current?.focus();
    }
  }, [thread?.id]);

  const handleSubmit = () => {
    if (!thread || !input.trim() || thread.status === "running") return;
    onSend(thread.id, input.trim());
    setInput("");
  };

  useEffect(() => {
    if (!modelDropdownOpen && !effortDropdownOpen && !modeDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (modelDropdownOpen && modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
      if (effortDropdownOpen && effortDropdownRef.current && !effortDropdownRef.current.contains(e.target as Node)) {
        setEffortDropdownOpen(false);
      }
      if (modeDropdownOpen && modeDropdownRef.current && !modeDropdownRef.current.contains(e.target as Node)) {
        setModeDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [modelDropdownOpen, effortDropdownOpen, modeDropdownOpen]);

  if (!thread) {
    return (
      <div
        className="flex-1 flex items-center justify-center text-[13px]"
        style={{ color: "var(--text-muted)" }}
      >
        No thread selected
      </div>
    );
  }

  const isClaude = thread.provider === "claude";
  const modelLabel = isClaude ? selectedModel.label : "GPT-5.6";

  return (
    <div
      className="flex-1 flex flex-col min-w-0 min-h-0"
    >
      {/* Title bar area */}
      <div
        className="h-[38px] shrink-0 flex items-center justify-center"
        style={{
          borderBottom: "1px solid var(--border-subtle)",
          // @ts-expect-error -- webkit
          WebkitAppRegion: "drag",
        }}
      >
        <span
          className="text-[12px] font-medium truncate max-w-[55%]"
          style={{ color: "rgba(255,255,255,0.60)" }}
        >
          {thread.name}
        </span>
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollAreaRef} className="flex-1" onScroll={handleMessagesScroll}>
        {thread.messages.length === 0 ? (
          <div
            className="flex items-center justify-center h-full text-[13px]"
            style={{ color: "var(--text-muted)" }}
          >
            Start a conversation
          </div>
        ) : (
          <div className="max-w-[720px] mx-auto px-5 py-3">
            {thread.messages.map((msg, i) => {
              // Show hover bar only on the last assistant message before the next user message
              // (tool_use entries between assistant messages don't break the group)
              let showHoverBar = true;
              if (msg.role === "assistant") {
                let j = i + 1;
                while (j < thread.messages.length && thread.messages[j].role === "tool_use") j++;
                showHoverBar = j >= thread.messages.length || thread.messages[j].role === "user";
              }
              return (
                <MessageBlock
                  key={msg.id}
                  message={msg}
                  isStreaming={
                    thread.status === "running" &&
                    msg.role === "assistant" &&
                    i === thread.messages.length - 1
                  }
                  showHoverBar={showHoverBar}
                />
              );
            })}
            {thread.status === "running" && thread.messages[thread.messages.length - 1]?.role !== "assistant" && (
              <div className="py-4 px-1">
                <ThinkingIndicator />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Scroll to bottom */}
      {showScrollBtn && thread.messages.length > 0 && (
        <div className="relative shrink-0">
          <button
            onClick={() => scrollAreaRef.current?.scrollToBottom()}
            className="absolute left-1/2 -translate-x-1/2 -top-14 w-[36px] h-[36px] flex items-center justify-center rounded-full transition-colors"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border-emphasis)",
              color: "var(--text-primary)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface-3)";
              e.currentTarget.style.borderColor = "var(--text-muted)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--surface-2)";
              e.currentTarget.style.borderColor = "var(--border-emphasis)";
            }}
          >
            <ArrowDown size={18} weight="bold" />
          </button>
        </div>
      )}

      {/* Composer */}
      <div className="shrink-0 px-5 pb-4 pt-1">
        <div className="max-w-[720px] mx-auto">
          <div
            className="rounded-2xl"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border-default)",
            }}
          >
            <TextareaWithScrollbar
              textareaRef={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            {/* Controls */}
            <div className="flex items-center justify-between px-2 pb-2">
              <div className="flex items-center gap-0">
<div className="relative" ref={modelDropdownRef}>
                  <ControlButton onClick={() => isClaude && setModelDropdownOpen((v) => !v)}>
                    <ClaudeIcon className="w-[14px] h-[14px] shrink-0 text-[#D97757]" />
                    <span>{modelLabel}</span>
                    <CaretDown size={10} weight="bold" />
                  </ControlButton>
                  {modelDropdownOpen && isClaude && (
                    <ModelDropdown
                      models={CLAUDE_MODELS}
                      selected={selectedModel}
                      onSelect={(m) => {
                        setSelectedModel(m);
                        setModelDropdownOpen(false);
                      }}
                    />
                  )}
                </div>
                <div className="relative" ref={effortDropdownRef}>
                  <ControlButton onClick={() => setEffortDropdownOpen((v) => !v)}>
                    <span>{selectedEffort.label}</span>
                    <CaretDown size={10} weight="bold" />
                  </ControlButton>
                  {effortDropdownOpen && (
                    <EffortDropdown
                      levels={EFFORT_LEVELS}
                      selected={selectedEffort}
                      onSelect={(e) => {
                        setSelectedEffort(e);
                        setEffortDropdownOpen(false);
                      }}
                    />
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="relative" ref={modeDropdownRef}>
                  <ControlButton onClick={() => setModeDropdownOpen((v) => !v)}>
                    <span>{selectedMode.label}</span>
                    <CaretDown size={10} weight="bold" />
                  </ControlButton>
                  {modeDropdownOpen && (
                    <ModeDropdown
                      modes={MODES}
                      selected={selectedMode}
                      onSelect={(m) => {
                        setSelectedMode(m);
                        setModeDropdownOpen(false);
                      }}
                    />
                  )}
                </div>
                {thread.status === "running" ? (
                  <button
                    onClick={() => onInterrupt(thread.id)}
                    className="w-[30px] h-[30px] flex items-center justify-center rounded-full"
                    style={{
                      background: "var(--text-primary)",
                    }}
                  >
                    <Stop size={14} weight="fill" style={{ color: "var(--surface-0)" }} />
                  </button>
                ) : (
                  <button
                    onClick={handleSubmit}
                    disabled={!input.trim()}
                    className="w-[30px] h-[30px] flex items-center justify-center rounded-full transition-colors"
                    style={{
                      background: input.trim()
                        ? "var(--text-primary)"
                        : "var(--surface-3)",
                      color: input.trim() ? "var(--surface-0)" : "var(--text-faint)",
                    }}
                  >
                    <ArrowUp size={16} weight="bold" />
                  </button>
                )}
              </div>
            </div>
          </div>
          {/* Status info */}
          <div className="flex items-center gap-1 mt-2 px-0.5">
            <StatusButton>
              <Monitor size={14} weight="regular" />
              <span>Local</span>
              <CaretDown size={10} weight="bold" />
            </StatusButton>
            {thread.branch && (
              <StatusButton>
                <GitBranch size={14} weight="regular" />
                <span>{thread.branch}</span>
                <CaretDown size={10} weight="bold" />
              </StatusButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      className="flex items-center gap-1.5 px-2 py-[3px] rounded-lg text-[12px] font-medium transition-colors"
      style={{ color: "var(--text-muted)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--border-subtle)";
        e.currentTarget.style.color = "rgba(255,255,255,0.60)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--text-muted)";
      }}
    >
      {children}
    </button>
  );
}

function ControlButton({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 py-[5px] rounded-xl text-[13px] font-medium transition-colors"
      style={{ color: "var(--text-muted)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--border-subtle)";
        e.currentTarget.style.color = "rgba(255,255,255,0.60)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--text-muted)";
      }}
    >
      {children}
    </button>
  );
}

/* ── Model dropdown ─────────────────────────────────────────── */

function ModelDropdown({
  models,
  selected,
  onSelect,
}: {
  models: ModelDef[];
  selected: ModelDef;
  onSelect: (m: ModelDef) => void;
}) {
  return (
    <div
      className="absolute bottom-full left-0 mb-2 rounded-2xl p-1.5 min-w-[260px] z-50 flex flex-col gap-[2px]"
      style={{
        background: "var(--surface-3)",
        border: "1px solid var(--border-emphasis)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      {models.map((m) => {
        const isSelected = m.id === selected.id;
        return (
          <button
            key={m.id}
            onClick={() => onSelect(m)}
            className="w-full flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors"
            style={{
              background: isSelected ? "rgba(255,255,255,0.06)" : "transparent",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = isSelected ? "rgba(255,255,255,0.06)" : "transparent")}
          >
            <ClaudeIcon className="w-[20px] h-[20px] shrink-0 mt-0.5 text-[#D97757]" />
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <span
                className="text-[13px] font-medium leading-tight"
                style={{ color: "var(--text-primary)" }}
              >
                {m.label}
              </span>
              <span
                className="text-[11px] font-medium leading-tight"
                style={{ color: "var(--text-muted)" }}
              >
                {m.subtitle}
              </span>
            </div>
            {isSelected && (
              <Check size={14} weight="bold" className="shrink-0 mt-0.5" style={{ color: "var(--text-primary)" }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── Effort dropdown ───────────────────────────────────────── */

function EffortDropdown({
  levels,
  selected,
  onSelect,
}: {
  levels: EffortDef[];
  selected: EffortDef;
  onSelect: (e: EffortDef) => void;
}) {
  return (
    <div
      className="absolute bottom-full left-0 mb-2 rounded-2xl p-1.5 min-w-[280px] z-50 flex flex-col gap-[2px]"
      style={{
        background: "var(--surface-3)",
        border: "1px solid var(--border-emphasis)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      {levels.map((lvl) => {
        const isSelected = lvl.id === selected.id;
        return (
          <button
            key={lvl.id}
            onClick={() => onSelect(lvl)}
            className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors"
            style={{
              background: isSelected ? "rgba(255,255,255,0.06)" : "transparent",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = isSelected ? "rgba(255,255,255,0.06)" : "transparent")}
          >
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <span
                className="text-[13px] font-medium leading-tight"
                style={{ color: "var(--text-primary)" }}
              >
                {lvl.label}
              </span>
              <span
                className="text-[11px] font-medium leading-tight"
                style={{ color: "var(--text-muted)" }}
              >
                {lvl.subtitle}
              </span>
            </div>
            {isSelected && (
              <Check size={14} weight="bold" className="shrink-0" style={{ color: "var(--text-primary)" }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── Mode dropdown ─────────────────────────────────────────── */

function ModeDropdown({
  modes,
  selected,
  onSelect,
}: {
  modes: ModeDef[];
  selected: ModeDef;
  onSelect: (m: ModeDef) => void;
}) {
  return (
    <div
      className="absolute bottom-full right-0 mb-2 rounded-2xl p-1.5 min-w-[300px] z-50 flex flex-col gap-[2px]"
      style={{
        background: "var(--surface-3)",
        border: "1px solid var(--border-emphasis)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      {modes.map((mode) => {
        const isSelected = mode.id === selected.id;
        return (
          <button
            key={mode.id}
            onClick={() => onSelect(mode)}
            className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors"
            style={{
              background: isSelected ? "rgba(255,255,255,0.06)" : "transparent",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = isSelected ? "rgba(255,255,255,0.06)" : "transparent")}
          >
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <span
                className="text-[13px] font-medium leading-tight"
                style={{ color: "var(--text-primary)" }}
              >
                {mode.label}
              </span>
              <span
                className="text-[11px] font-medium leading-tight"
                style={{ color: "var(--text-muted)" }}
              >
                {mode.subtitle}
              </span>
            </div>
            {isSelected && (
              <Check size={14} weight="bold" className="shrink-0" style={{ color: "var(--text-primary)" }} />
            )}
          </button>
        );
      })}
    </div>
  );
}
