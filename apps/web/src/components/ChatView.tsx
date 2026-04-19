import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
  memo,
  createContext,
  useContext,
} from "react";
import { createPortal } from "react-dom";
import finderIconUrl from "../assets/finder.png";
import terminalIconUrl from "../assets/apple-terminal.png";
import ghosttyIconUrl from "../assets/ghostty.png";
import { ScrollArea, type ScrollAreaHandle } from "./ScrollArea";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
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
  X,
  ImageSquare,
  Folder,
  FolderPlus,
  Plus,
  ArrowSquareOut,
} from "@phosphor-icons/react";
import { QuestionnaireForm } from "./QuestionCard";
import { PlanApprovalCard } from "./PlanApprovalCard";
import { ToolApprovalCard } from "./ToolApprovalCard";
import {
  DropdownSurface,
  DropdownItem,
  DropdownDivider,
  DropdownSectionHeader,
} from "./Dropdown";
import type { Thread, Message, FileChange, ContextStats } from "../App";
import { EditorTarget, type PendingRequest, type ProjectInfo, type UserMode } from "@openclawdex/shared";

/* ── Editor logos ────────────────────────────────────────────── */

function VSCodeIcon({ size = 14 }: { size?: number }) {
  // simple-icons VSCode glyph (stylized blue ribbon)
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="#3DA0E2"
      aria-hidden
    >
      <path d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448z" />
    </svg>
  );
}

function CursorIcon({ size = 14 }: { size?: number }) {
  // Official Cursor light logo (outlined hex)
  return (
    <svg
      viewBox="0 0 466.73 532.09"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
    >
      <path d="M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z" />
    </svg>
  );
}

function FinderIcon({ size = 14 }: { size?: number }) {
  return (
    <img
      src={finderIconUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
    />
  );
}

function TerminalIcon({ size = 14 }: { size?: number }) {
  return (
    <img
      src={terminalIconUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      style={{ transform: "scale(1.3)", transformOrigin: "center" }}
    />
  );
}

function GhosttyIcon({ size = 14 }: { size?: number }) {
  return (
    <img
      src={ghosttyIconUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      style={{ transform: "scale(1.3)", transformOrigin: "center" }}
    />
  );
}

function ITermIcon({ size = 14 }: { size?: number }) {
  // Official iTerm2 glyph
  return (
    <svg viewBox="100 100 824 824" width={size} height={size} aria-hidden>
      <defs>
        <linearGradient
          id="iterm-grad"
          x1="512"
          y1="100"
          x2="512"
          y2="924"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#D4E6E8" />
          <stop offset="1" stopColor="#767573" />
        </linearGradient>
      </defs>
      <rect
        x="100"
        y="100"
        width="824"
        height="824"
        rx="179"
        fill="url(#iterm-grad)"
      />
      <rect
        x="121.788"
        y="121.789"
        width="780.423"
        height="780.423"
        rx="156"
        fill="black"
      />
      <rect
        x="183.192"
        y="183.192"
        width="657.615"
        height="657.615"
        rx="94"
        fill="#202A2F"
      />
      <rect
        x="367.404"
        y="226.769"
        width="89.1346"
        height="178.269"
        fill="#0EE827"
        fillOpacity="0.35"
      />
      <path
        fill="#0EE827"
        d="M274.468 374.622C269.807 374.227 265.438 373.568 261.36 372.645C257.427 371.59 253.786 370.47 250.436 369.284C247.232 368.097 244.392 366.977 241.916 365.922C239.586 364.736 237.838 363.813 236.673 363.154L246.067 345.754C247.086 346.413 248.834 347.335 251.31 348.522C253.786 349.708 256.553 350.96 259.612 352.279C262.816 353.465 266.093 354.52 269.443 355.442C272.793 356.365 275.924 356.827 278.837 356.827C293.402 356.827 300.684 351.356 300.684 340.415C300.684 337.778 300.174 335.603 299.154 333.89C298.281 332.176 296.897 330.726 295.004 329.54C293.256 328.221 291.071 327.101 288.45 326.178C285.974 325.124 283.134 324.069 279.929 323.015C273.812 320.905 268.351 318.73 263.544 316.489C258.884 314.117 254.878 311.48 251.529 308.58C248.179 305.68 245.63 302.385 243.882 298.694C242.135 295.003 241.261 290.784 241.261 286.039C241.261 282.348 242.062 278.789 243.664 275.361C245.266 271.934 247.523 268.902 250.436 266.266C253.349 263.498 256.845 261.191 260.923 259.345C265.001 257.368 269.516 255.984 274.468 255.193V226.769H292.382V254.797C296.169 255.193 299.81 255.786 303.305 256.577C306.801 257.368 309.932 258.225 312.699 259.147C315.467 260.07 317.797 260.993 319.69 261.916C321.729 262.707 323.186 263.3 324.06 263.695L315.321 279.909C314.156 279.382 312.481 278.723 310.296 277.932C308.257 277.009 305.927 276.086 303.305 275.164C300.684 274.241 297.844 273.45 294.785 272.791C291.727 272.132 288.668 271.802 285.61 271.802C280.658 271.802 276.215 272.725 272.283 274.57C268.496 276.284 266.603 279.25 266.603 283.468C266.603 286.105 267.113 288.478 268.132 290.587C269.297 292.564 270.899 294.344 272.938 295.925C275.123 297.507 277.745 299.023 280.803 300.473C284.007 301.791 287.649 303.11 291.727 304.428C297.115 306.405 301.922 308.448 306.145 310.558C310.369 312.667 313.937 315.039 316.85 317.676C319.763 320.312 321.948 323.344 323.404 326.771C325.006 330.199 325.807 334.219 325.807 338.833C325.807 342.788 325.079 346.61 323.623 350.301C322.312 353.992 320.2 357.42 317.287 360.583C314.52 363.747 311.025 366.515 306.801 368.888C302.723 371.129 297.916 372.777 292.382 373.831V403.058H274.468V374.622Z"
      />
    </svg>
  );
}

/* ── Editor target helpers ───────────────────────────────────── */

function isEditorTarget(v: string): v is EditorTarget {
  return EditorTarget.safeParse(v).success;
}

function editorLabel(t: EditorTarget): string {
  switch (t) {
    case "vscode":
      return "VSCode";
    case "cursor":
      return "Cursor";
    case "finder":
      return "Finder";
    case "terminal":
      return "Terminal";
    case "iterm":
      return "iTerm2";
    case "ghostty":
      return "Ghostty";
  }
}

function EditorTargetIcon({
  target,
  size = 16,
}: {
  target: EditorTarget;
  size?: number;
}) {
  switch (target) {
    case "vscode":
      return <VSCodeIcon size={size} />;
    case "cursor":
      return (
        <span style={{ color: "var(--text-primary)", display: "inline-flex" }}>
          <CursorIcon size={size} />
        </span>
      );
    case "finder":
      return <FinderIcon size={size} />;
    case "terminal":
      return <TerminalIcon size={size} />;
    case "iterm":
      return <ITermIcon size={size} />;
    case "ghostty":
      return <GhosttyIcon size={size} />;
  }
}

/* ── Open-in-editor context ─────────────────────────────────── */

/** Provides an "open file in the user's preferred editor" handler to nested content. */
interface OpenFileCtx {
  open: (path: string, line?: number) => void;
  editorLabel: string;
}
export const OpenFileContext = createContext<OpenFileCtx | null>(null);

/**
 * Parse a file reference like `path/to/file.tsx`, `file.tsx:42`, or
 * `file.tsx (line 42)` / `file.tsx (lines 42-50)` into path + optional line.
 * Also handles lists/ranges after the first line number, e.g.
 * `file.tsx:85, 116, 128` or `file.tsx:190–191` — the first number wins.
 */
function isLikelyFilePath(text: string): boolean {
  if (!/[\/]/.test(text)) return false;
  if (
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text) &&
    !text.startsWith("file://")
  ) {
    return false;
  }
  if (/["'`()\[\]{};*?]/.test(text)) return false;
  if (!/\s/.test(text)) return true;
  return /^(\/|\.{1,2}\/|~\/|file:\/\/)/.test(text);
}

function parseFileRef(text: string): { path: string; line?: number } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    // Keep the original text if it is not valid URI encoding.
  }
  const normalized = decoded.startsWith("file://") ? decoded.slice(7) : decoded;
  // "file (line 42)" or "file (lines 42-50)"
  const parenMatch = normalized.match(/^(.+?)\s*\(lines?\s+(\d+)(?:-\d+)?\)$/i);
  if (parenMatch && isLikelyFilePath(parenMatch[1])) {
    return { path: parenMatch[1], line: Number(parenMatch[2]) };
  }
  // "file:42", "file:42:5", "file:42, 50, 60", "file:190–191", etc.
  // Accept any non-digit trailer after the first line number so comma lists
  // and en/em-dash ranges don't poison the path.
  const colonMatch = normalized.match(/^(.+?):(\d+)(?:\D.*)?$/);
  if (colonMatch && isLikelyFilePath(colonMatch[1])) {
    return { path: colonMatch[1], line: Number(colonMatch[2]) };
  }
  if (isLikelyFilePath(normalized)) return { path: normalized };
  return null;
}

/* ── Image attachment type ─────────────────────────────────── */

export interface ImageAttachment {
  id: string;
  file: File;
  name: string;
  previewUrl: string;
}

export interface ImagePayload {
  name: string;
  base64: string;
  mediaType: string;
  /**
   * Filesystem path when the file came from the OS (Electron drag-drop
   * sets `File.path`). Codex uses this directly via `local_image`, so
   * we can skip writing a tempfile in the main process. Clipboard
   * pastes yield blob-only images with no backing file — `path` stays
   * undefined in that case.
   */
  path?: string;
}

/* ── Claude sparkle icon ────────────────────────────────────── */

function ClaudeIcon({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 248 248"
      fill="currentColor"
      className={className}
      style={style}
    >
      <path d="M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z" />
    </svg>
  );
}

/* ── OpenAI blossom icon ────────────────────────────────────── */

function OpenAIIcon({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={style}
    >
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.3927-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
}

/* ── Model definitions ──────────────────────────────────────── */

import type { Provider } from "@openclawdex/shared";

interface ModelDef {
  id: string;
  label: string;
  subtitle: string;
  provider: Provider;
  // Optional compact suffix rendered next to the label in a muted
  // color — used for "1M context" variants the way Claude Desktop
  // displays them, e.g. `Opus 4.7 [1M]`.
  badge?: string;
  // Reasoning-effort IDs this model supports (e.g. ["low","medium","high"]).
  // `undefined` means unknown → render the full provider effort list as
  // a fallback (existing hardcoded CLAUDE_EFFORT/CODEX_EFFORT behavior).
  // An empty array means the model has no reasoning-effort control
  // (e.g. Haiku) → the effort picker is hidden entirely.
  supportedEfforts?: string[];
  // Provider-declared default effort for this model. When the user
  // manually picks the model from the dropdown we snap the effort to
  // this value so each model lands on its own recommended setting
  // (e.g. Codex's `defaultReasoningEffort`). Claude's SDK doesn't
  // expose a default, so it stays undefined for Claude models.
  defaultEffort?: string;
}

// Shared formatters so the picker looks uniform across providers.
//
// The two SDKs hand us very different label conventions:
//   - Codex: brand-prefixed `displayName` ("GPT-5.4"), short
//     single-sentence `description`.
//   - Claude: bare model-family `displayName` ("Sonnet"), long
//     two-clause `description` joined by " · ".
//
// We normalize to: `{Brand} {displayName}` as the label, and the
// first clause of description as the subtitle.
function formatModelLabel(displayName: string, brand: string): string {
  // Claude's default entry tags itself as "Default (recommended)" —
  // nothing else in the picker carries a parenthetical modifier, so
  // strip it for consistency.
  const cleaned = displayName.replace(/\s*\(recommended\)\s*$/i, "").trim();
  // Codex's `model/list` returns most display names as lowercase
  // hyphenated slugs ("gpt-5.2-codex") with only the occasional
  // properly-cased one ("GPT-5.4-Mini"). Normalize every segment so
  // the list looks uniform: uppercase the `GPT` brand, titlecase
  // word segments, leave version numbers ("5.4") alone.
  const titlecased = cleaned
    .split("-")
    .map((seg) => {
      if (seg.length === 0) return seg;
      if (/^\d/.test(seg)) return seg;
      // Only normalize segments the SDK hands back in all-lowercase
      // (Codex slugs). Preserve already-cased segments like "Mini" or
      // Claude's "Sonnet (1M context)" where the internal capital
      // matters.
      if (seg !== seg.toLowerCase()) return seg;
      if (seg === "gpt") return "GPT";
      return seg.charAt(0).toUpperCase() + seg.slice(1);
    })
    .join("-");
  // If the SDK already brand-prefixed the name (Codex's "GPT-…"),
  // don't double-prefix.
  return titlecased.toLowerCase().startsWith(brand.toLowerCase())
    ? titlecased
    : `${brand} ${titlecased}`;
}

function formatModelSubtitle(description: string): string {
  const [first] = description.split(" · ");
  return first.trim();
}

// Module-level cache — same shape as the Codex one. Fetching Claude's
// model list is more expensive (~1–2s cold-start of the CLI) so we
// never want to do it twice in a single app lifetime.
let claudeModelsCache: ModelDef[] | null = null;
let claudeModelsPromise: Promise<ModelDef[]> | null = null;

function loadClaudeModels(): Promise<ModelDef[]> {
  if (claudeModelsCache) return Promise.resolve(claudeModelsCache);
  if (!claudeModelsPromise) {
    claudeModelsPromise = window.openclawdex
      .listClaudeModels()
      .then((models) => {
        const result: ModelDef[] =
          models.length > 0
            ? models.map((m) => {
                // Claude's `description` is a " · "-joined string where
                // the first clause names the actual model+version
                // ("Opus 4.7 with 1M context") and the rest is
                // marketing and/or billing copy. That first clause is
                // far more informative than `displayName` ("Default")
                // so we use it as the label.
                //
                // We also split " with NM context" off the first
                // clause into a compact badge (the convention Claude
                // Desktop uses) and filter out billing clauses from
                // the subtitle — those belong on a plan screen, not
                // a model picker.
                const [head, ...rest] = m.description.split(" · ");
                const rawHead = (head ?? m.displayName).trim();
                const ctxMatch = rawHead.match(
                  /^(.*?)\s+with\s+(\S+)\s+context\s*$/i,
                );
                const label = ctxMatch ? ctxMatch[1].trim() : rawHead;
                const badge = ctxMatch ? ctxMatch[2] : undefined;
                const subtitle = rest
                  .map((s) => s.trim())
                  .filter(
                    (s) =>
                      s.length > 0 && !/\bbilled\b/i.test(s) && !/\$/.test(s),
                  )
                  .join(" · ");
                // `supportsEffort: false` or a missing
                // `supportedEffortLevels` array (e.g. Haiku) means the
                // model has no reasoning knob — represent that as an
                // empty list so the effort picker hides.
                const supportedEfforts =
                  m.supportsEffort && m.supportedEffortLevels
                    ? m.supportedEffortLevels
                    : [];
                // Claude's SDK doesn't surface a default-effort field,
                // but the convention is to pick the deepest reasoning
                // the model supports: `xhigh` if available (Opus),
                // otherwise `high` (Sonnet et al.). Models with neither
                // (e.g. Haiku has no effort knob) get no default.
                const defaultEffort = supportedEfforts.includes("xhigh")
                  ? "xhigh"
                  : supportedEfforts.includes("high")
                    ? "high"
                    : undefined;
                return {
                  id: m.value,
                  label,
                  subtitle: subtitle || m.displayName,
                  provider: "claude" as const,
                  badge,
                  supportedEfforts,
                  defaultEffort,
                };
              })
            : [];
        claudeModelsCache = result;
        return result;
      })
      .catch((err) => {
        // Cosmetic fallback: the picker renders a hardcoded list when
        // this returns empty. Log so the failure is diagnosable — no
        // user-facing alert, the picker degrades gracefully.
        console.error("[List Claude models] failed:", err);
        return [] as ModelDef[];
      });
  }
  return claudeModelsPromise;
}

// Parse a Codex model slug ("gpt-5.1-codex-max") into a human-friendly
// label. OpenAI's own `displayName` field mixes casing ("gpt-5.2-codex"
// vs "GPT-5.4-Mini") and the hyphenated slugs look like path names in
// the picker. Normalize by treating `codex` as the primary product
// name when present (matching OpenAI's own "Codex CLI" branding), with
// other suffixes like `mini`/`max` as variant qualifiers.
//
// Shape mirrors Claude Desktop's convention of "{Product} {Version}":
//   gpt-5.4              → "GPT-5.4"
//   gpt-5.4-mini         → "GPT-5.4 Mini"
//   gpt-5.3-codex        → "Codex 5.3"
//   gpt-5.1-codex-max    → "Codex 5.1 Max"
//   gpt-5.1-codex-mini   → "Codex 5.1 Mini"
function prettyCodexLabel(slug: string): string {
  const match = slug.toLowerCase().match(/^gpt-(\d+(?:\.\d+)?)(.*)$/);
  if (!match) return slug;
  const [, version, rest] = match;
  const parts = rest.split("-").filter(Boolean);
  const hasCodex = parts.includes("codex");
  const variants = parts
    .filter((p) => p !== "codex")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  const variantStr = variants.length > 0 ? ` ${variants.join(" ")}` : "";
  return hasCodex
    ? `Codex ${version}${variantStr}`
    : `GPT-${version}${variantStr}`;
}

// OpenAI's `model/list` description field is full of repeated
// boilerplate — 3 of the 7 entries open with "frontier agentic coding
// model" — which makes the picker hard to scan. Derive a concise
// Claude-style subtitle from the slug suffix instead.
//
// We intentionally ignore the `upgrade` field even though it's in the
// payload: OpenAI flags older models as "superseded" but they remain
// fully usable and some users prefer them. Framing them as superseded
// in the picker would make them feel obsolete, which they aren't.
function codexSubtitle(model: { model: string; isDefault: boolean }): string {
  if (model.isDefault) return "Most capable";
  const slug = model.model.toLowerCase();
  if (/-mini$/.test(slug)) return "Smaller, faster";
  if (/-max$/.test(slug)) return "Deepest reasoning";
  if (/-codex(-|$)/.test(slug)) return "Coding-specialized";
  return "Professional work";
}

// Module-level cache so a freshly-mounted ChatView doesn't re-IPC if
// another instance has already fetched. Main-process side also caches
// so repeat calls are cheap, but the extra round-trip is still visible
// on thread-switch.
let codexModelsCache: ModelDef[] | null = null;
let codexModelsPromise: Promise<ModelDef[]> | null = null;

/**
 * Pick the initial `selectedModel` for a freshly-mounted ChatView.
 *
 * Tries to honour the persisted `lastSelection` so users who ended
 * their last session on Codex don't see Claude's label flash on
 * re-open. Falls back to the first cached Claude model, then the first
 * cached Codex model, then `null` (the sync effect inside the
 * component will fill it in once a live list arrives).
 */
function pickInitialModel(): ModelDef | null {
  try {
    const raw = localStorage.getItem("lastSelection");
    if (raw) {
      const saved = JSON.parse(raw) as {
        provider?: unknown;
        modelId?: unknown;
      };
      const cache =
        saved.provider === "codex" ? codexModelsCache : claudeModelsCache;
      if (cache && typeof saved.modelId === "string") {
        const match = cache.find((m) => m.id === saved.modelId);
        if (match) return match;
        // Known provider but unknown model (e.g. a model that was
        // removed upstream) — fall back to the head of that list
        // rather than crossing providers.
        if (cache.length > 0) return cache[0];
      }
    }
  } catch {
    /* fall through to defaults */
  }
  return claudeModelsCache?.[0] ?? codexModelsCache?.[0] ?? null;
}

function loadCodexModels(): Promise<ModelDef[]> {
  if (codexModelsCache) return Promise.resolve(codexModelsCache);
  if (!codexModelsPromise) {
    codexModelsPromise = window.openclawdex
      .listCodexModels()
      .then((models) => {
        // Empty means main process couldn't fetch (no Codex installed,
        // app-server failed, etc.). We surface that as an empty list
        // rather than hardcoding fallback models.
        const result: ModelDef[] = models.map((m) => ({
          id: m.model,
          label: prettyCodexLabel(m.model),
          subtitle: m.description.replace(/\.$/, ""),
          provider: "codex" as const,
          supportedEfforts: m.supportedReasoningEfforts.map(
            (e) => e.reasoningEffort,
          ),
          defaultEffort: m.defaultReasoningEffort,
        }));
        codexModelsCache = result;
        return result;
      })
      .catch((err) => {
        // Same policy as Claude: log + fall through to empty so the
        // picker's empty-list branch renders.
        console.error("[List Codex models] failed:", err);
        return [] as ModelDef[];
      });
  }
  return codexModelsPromise;
}

/* ── Effort levels ──────────────────────────────────────────── */

interface EffortDef {
  id: string;
  label: string;
  subtitle: string;
}

// GOTCHA: Claude and Codex have DIFFERENT effort vocabularies — do NOT
// merge these lists. Claude supports 4 levels (max/high/medium/low) while
// the Codex SDK's `modelReasoningEffort` accepts 5
// (minimal/low/medium/high/xhigh). The picker renders the right one based
// on the thread's provider.
const CLAUDE_EFFORT: EffortDef[] = [
  { id: "max", label: "Max", subtitle: "Extended thinking, highest quality" },
  // GOTCHA: "xhigh" is Opus-only. The SDK's `ModelInfo` TS type
  // declares effort as `low|medium|high|max`, but the wire data
  // contains `xhigh` too — we need the entry here so the per-model
  // filter can surface it when a model actually supports it.
  { id: "xhigh", label: "Extra high", subtitle: "Deepest reasoning" },
  { id: "high", label: "High", subtitle: "Thorough reasoning" },
  { id: "medium", label: "Medium", subtitle: "Balanced speed and quality" },
  { id: "low", label: "Low", subtitle: "Fast, minimal reasoning" },
];

const CODEX_EFFORT: EffortDef[] = [
  { id: "xhigh", label: "Extra high", subtitle: "Deepest reasoning, slowest" },
  { id: "high", label: "High", subtitle: "Thorough reasoning" },
  { id: "medium", label: "Medium", subtitle: "Balanced speed and quality" },
  { id: "low", label: "Low", subtitle: "Fast, minimal reasoning" },
  {
    id: "minimal",
    label: "Minimal",
    subtitle: "Fastest, barely any reasoning",
  },
];

/* ── Modes ──────────────────────────────────────────────────── */

interface ModeDef {
  id: UserMode;
  label: string;
  subtitle: string;
}

const MODES: ModeDef[] = [
  {
    id: "plan",
    label: "Plan",
    subtitle: "Outline a plan without making changes",
  },
  {
    id: "ask",
    label: "Ask permissions",
    subtitle: "Confirm each file change before applying",
  },
  {
    id: "acceptEdits",
    label: "Auto-accept edits",
    subtitle: "Apply changes without asking",
  },
  {
    id: "bypassPermissions",
    label: "Bypass permissions",
    subtitle: "Run any tool without prompting",
  },
];

const DEFAULT_MODE: ModeDef = MODES[2]; // acceptEdits — matches new-thread default.
function modeById(id: UserMode | undefined): ModeDef {
  return MODES.find((m) => m.id === id) ?? DEFAULT_MODE;
}

/* ── File change card ────────────────────────────────────────── */

function FileChangeCard({
  changes,
  onOpenFile,
}: {
  changes: FileChange[];
  onOpenFile?: (path: string) => void;
}) {
  const ctx = useContext(OpenFileContext);
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
        <span
          className="text-[13px] font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
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
        <button
          key={i}
          onClick={() => onOpenFile?.(fc.path)}
          className="w-full flex items-center gap-2 px-3 py-[7px] transition-colors text-left"
          style={{ cursor: onOpenFile ? "pointer" : "default" }}
          title={
            onOpenFile ? `Open in ${ctx?.editorLabel ?? "editor"}` : undefined
          }
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "rgba(255,255,255,0.02)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          <FileText
            size={13}
            weight="regular"
            style={{ color: "var(--text-faint)" }}
          />
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
        </button>
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

function ThinkingIndicator({ label = "Thinking…" }: { label?: string }) {
  return (
    <div
      className="thinking-shimmer flex items-center gap-2 text-[14px] font-medium"
      style={{ color: "rgba(255,255,255,0.60)" }}
    >
      {label}
    </div>
  );
}

/* ── Streaming markdown ──────────────────────────────────────── */

/**
 * Patches mid-stream markdown so incomplete syntax doesn't render as
 * literal characters while we're waiting for the closer to arrive.
 * Only handles the disruptive cases (unclosed fenced code blocks,
 * unclosed links/images, unclosed inline code on the tail line).
 * Bold/italic markers are left alone — they render as stray asterisks
 * for one frame but aren't visually jarring.
 */
function closeOpenMarkdown(text: string): string {
  let out = text;

  // 1. Unclosed fenced code block: odd count of ``` at start of line.
  const fenceMatches = out.match(/^```/gm);
  if (fenceMatches && fenceMatches.length % 2 === 1) {
    // Ensure the fence is on its own line before appending.
    if (!out.endsWith("\n")) out += "\n";
    out += "```";
  }

  // 2. Unclosed link / image at the very end: "[label](incomplete"
  //    -> render as just "[label]" until the URL arrives.
  out = out.replace(/(!?)\[([^\]\n]*)\]\([^)\n]*$/, "$1[$2]");

  // 2b. Unclosed "[" or "![" with no closing "]" yet — strip it so the
  //     user doesn't see a stray opening bracket for a frame. Note:
  //     step 2 always produces a "]" when it fires, so the two rules
  //     don't step on each other.
  out = out.replace(/(!?)\[[^\]\n]*$/, "");

  // 3. Unclosed inline backtick on the last line (outside fenced blocks).
  //    If we already appended a closing fence above, the tail we care
  //    about is the text *before* that fence.
  const lastNewline = out.lastIndexOf("\n");
  const lastLine = lastNewline === -1 ? out : out.slice(lastNewline + 1);
  if (!lastLine.startsWith("```")) {
    const tickCount = (lastLine.match(/`/g) ?? []).length;
    if (tickCount % 2 === 1) out += "`";
  }

  return out;
}

/**
 * Finds the last block-boundary ("\n\n") in `text` that sits OUTSIDE an
 * open fenced code block. Returns the offset AFTER the boundary (i.e. the
 * start of the next block), or 0 if there's no valid boundary yet.
 *
 * We need this because splitting inside an unclosed ``` fence would cut a
 * code block in half — we want each markdown block to settle atomically.
 */
function findPendingStart(text: string): number {
  let searchEnd = text.length;
  while (searchEnd > 0) {
    const idx = text.lastIndexOf("\n\n", searchEnd - 1);
    if (idx === -1) return 0;
    const before = text.slice(0, idx);
    const fenceCount = (before.match(/^```/gm) ?? []).length;
    if (fenceCount % 2 === 0) {
      // Boundary is outside any open fence — safe to split here.
      return idx + 2;
    }
    // Inside an open fence; look further back.
    searchEnd = idx;
  }
  return 0;
}

/**
 * Streams assistant text with two zones:
 *   - Settled prefix (everything up to the last safe block boundary)
 *     renders as live markdown via MarkdownContent.
 *   - Pending block (the current block being typed) renders as a flat
 *     list of word-spans in a single `<p>`. No markdown parsing in the
 *     pending zone — raw `**`, `*`, backticks etc. show as literal
 *     characters until the block graduates to settled. This is the
 *     price of a rock-stable DOM: tokens use a monotonic key counter
 *     so they never collide or remount, each token animates exactly
 *     once on mount and then settles to a plain `<span>`, and no
 *     ReactMarkdown re-parse of the pending text can trigger a
 *     structural remount (because there's no structure).
 * When a new block boundary arrives (pending window advances), the
 * token array resets and the finished block graduates to settled
 * markdown on the next tick.
 */
function StreamingText({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  // Each entry is a single whitespace-delimited part of the pending
  // text, with a monotonically-increasing key so React never reuses
  // a span across different content.
  const tokens = useRef<
    { token: string; key: number; delay: number; settled: boolean }[]
  >([]);
  const pendingStart = useRef(0);
  const prevPendingLength = useRef(0);
  const nextKey = useRef(0);

  if (!isStreaming) {
    // Streaming ended — reset state and render the full text as markdown.
    tokens.current = [];
    pendingStart.current = 0;
    prevPendingLength.current = 0;
    nextKey.current = 0;
    return <MarkdownContent text={text} />;
  }

  const newPendingStart = findPendingStart(text);

  // The pending window moved forward: a new block boundary was reached.
  // Drop old tokens — that block is now part of the settled markdown.
  if (newPendingStart > pendingStart.current) {
    tokens.current = [];
    prevPendingLength.current = 0;
    pendingStart.current = newPendingStart;
    // Keep nextKey monotonically increasing to guarantee unique keys.
  }

  const pending = text.slice(pendingStart.current);

  if (pending.length > prevPendingLength.current) {
    // Settle all prior tokens so they stop animating.
    for (const t of tokens.current) t.settled = true;

    const fresh = pending.slice(prevPendingLength.current);
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
    prevPendingLength.current = pending.length;
  }

  const settled = text.slice(0, pendingStart.current);

  return (
    <>
      {settled && <MarkdownContent text={closeOpenMarkdown(settled)} />}
      {tokens.current.length > 0 && (
        <p className="mb-3 last:mb-0">
          {tokens.current.map(({ token, key, delay, settled: s }) =>
            /^\s+$/.test(token) ? (
              <span key={key}>{token}</span>
            ) : s ? (
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
        </p>
      )}
    </>
  );
}

/* ── Message block ───────────────────────────────────────────── */

function MessageHoverBar({
  message,
  reverse,
}: {
  message: Message;
  reverse?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const timeStr = message.timestamp.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  function handleCopy() {
    navigator.clipboard
      .writeText(message.content)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch((err) => {
        // Electron occasionally rejects clipboard writes when the
        // webContents isn't focused (e.g. devtools has focus). Log so
        // the failure is diagnosable; the button just won't flip to
        // "Copied".
        console.error("[Copy message] clipboard write failed:", err);
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
        {copied ? (
          <Check size={15} weight="bold" />
        ) : (
          <Copy size={15} weight="regular" />
        )}
      </button>
      <span
        className="text-[12px] font-medium"
        style={{ lineHeight: 1, color: "rgba(255,255,255,0.60)" }}
      >
        {timeStr}
      </span>
    </div>
  );
}

/* ── Tool use indicator ──────────────────────────────────────── */

/** Human-readable one-liner for a tool call. */
function toolSummary(name: string, input?: Record<string, unknown>): string {
  if (!input) return name;
  switch (name) {
    case "Bash": {
      const cmd = String(input.command ?? "");
      return cmd ? `$ ${cmd}` : "Bash";
    }
    case "Read": {
      const fp = String(input.file_path ?? "");
      const basename = fp.split("/").at(-1) ?? fp;
      return basename ? `Read ${basename}` : "Read";
    }
    case "Edit": {
      const fp = String(input.file_path ?? "");
      const basename = fp.split("/").at(-1) ?? fp;
      return basename ? `Edit ${basename}` : "Edit";
    }
    case "Write": {
      const fp = String(input.file_path ?? "");
      const basename = fp.split("/").at(-1) ?? fp;
      return basename ? `Write ${basename}` : "Write";
    }
    case "Grep": {
      const pat = String(input.pattern ?? "");
      return pat ? `Grep "${pat}"` : "Grep";
    }
    case "Glob": {
      const pat = String(input.pattern ?? "");
      return pat ? `Glob ${pat}` : "Glob";
    }
    case "WebFetch": {
      const url = String(input.url ?? "");
      return url ? `Fetch ${url}` : "WebFetch";
    }
    case "WebSearch": {
      const q = String(input.query ?? "");
      return q ? `Search "${q}"` : "WebSearch";
    }
    // ── Codex-specific tool names (emitted by CodexSession) ─────
    case "shell": {
      // Codex command_execution: run a shell command. Renders alongside
      // Claude's Bash tool.
      const cmd = String(input.command ?? "");
      return cmd ? `$ ${cmd}` : "shell";
    }
    case "apply_patch": {
      // Codex file_change: {changes: [{path, kind: {type: "add"|"delete"|"update"}}], status}
      // `kind` is an object on the wire, not a string — stringifying it
      // directly produced "[object Object]" in the label.
      const changes = Array.isArray(input.changes) ? input.changes : [];
      if (changes.length === 0) return "apply_patch";
      const first = changes[0] as { path?: string; kind?: { type?: string } };
      const base = first?.path ? first.path.split("/").at(-1) : null;
      const more = changes.length > 1 ? ` +${changes.length - 1}` : "";
      const kindLabel = typeof first?.kind?.type === "string" ? first.kind.type : "edit";
      return base ? `${kindLabel} ${base}${more}` : "apply_patch";
    }
    case "update_plan": {
      // Codex todo_list: rendered as a plan update
      const items = Array.isArray(input.items) ? input.items : [];
      return items.length > 0 ? `Plan (${items.length} steps)` : "update_plan";
    }
    case "web_search": {
      // Codex web_search (lowercase; distinct from Claude's "WebSearch")
      const q = String(input.query ?? "");
      return q ? `Search "${q}"` : "web_search";
    }
    default:
      return name;
  }
}

/** Return the file path this tool targets, if any (Read/Edit/Write/apply_patch). */
function toolFilePath(
  toolName: string,
  toolInput?: Record<string, unknown>,
): string | null {
  if (!toolInput) return null;
  if (toolName === "Read" || toolName === "Edit" || toolName === "Write") {
    const fp = toolInput.file_path;
    return typeof fp === "string" && fp.length > 0 ? fp : null;
  }
  if (toolName === "apply_patch") {
    // Codex file_change: return the first changed file's path
    const changes = Array.isArray(toolInput.changes) ? toolInput.changes : [];
    const first = changes[0] as { path?: string } | undefined;
    return typeof first?.path === "string" && first.path.length > 0
      ? first.path
      : null;
  }
  return null;
}

function ToolUseIndicator({
  toolName,
  toolInput,
  onOpenFile,
}: {
  toolName: string;
  toolInput?: Record<string, unknown>;
  onOpenFile?: (path: string) => void;
}) {
  const ctx = useContext(OpenFileContext);
  const summary = toolSummary(toolName, toolInput);
  const maxLen = 120;
  const display =
    summary.length > maxLen ? summary.slice(0, maxLen) + "…" : summary;
  const filePath = toolFilePath(toolName, toolInput);
  const clickable = filePath && onOpenFile;

  if (clickable) {
    return (
      <button
        onClick={() => onOpenFile(filePath)}
        title={`Open in ${ctx?.editorLabel ?? "editor"}`}
        className="w-full flex items-center gap-2 py-1.5 px-1 text-[13px] text-left rounded-md transition-colors"
        style={{
          color: "var(--text-muted)",
          fontFamily: "var(--font-code)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--text-secondary)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--text-muted)";
        }}
      >
        <span className="truncate">{display}</span>
      </button>
    );
  }

  return (
    <div
      className="flex items-center gap-2 py-1.5 px-1 text-[13px]"
      style={{
        color: "var(--text-muted)",
        fontFamily: "var(--font-code)",
      }}
    >
      <span className="truncate">{display}</span>
    </div>
  );
}

/* ── Token progress indicator ────────────────────────────────── */

function TokenProgressIndicator({ stats }: { stats: ContextStats }) {
  const r = 5.5;
  const circ = 2 * Math.PI * r;
  const hasContext =
    stats.percentage != null &&
    stats.totalTokens != null &&
    stats.maxTokens != null;
  const percent = hasContext ? Math.min(stats.percentage! / 100, 1) : 0;
  const offset = circ * (1 - percent);
  const pct = hasContext ? Math.round(stats.percentage!) : null;

  function fmt(n: number) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
    return String(n);
  }

  return (
    <div className="relative group/token ml-auto">
      <button
        className="flex items-center justify-center w-[24px] h-[24px] rounded-lg transition-colors"
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
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle
            cx="7"
            cy="7"
            r={r}
            stroke="currentColor"
            strokeOpacity="0.2"
            strokeWidth="1.5"
          />
          {hasContext && (
            <circle
              cx="7"
              cy="7"
              r={r}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform="rotate(-90 7 7)"
            />
          )}
        </svg>
      </button>
      {/* Tooltip */}
      <div
        className="absolute bottom-full right-0 mb-1.5 px-2.5 py-1.5 rounded-lg text-[12px] whitespace-nowrap pointer-events-none z-50 opacity-0 group-hover/token:opacity-100 transition-opacity duration-150"
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--border-emphasis)",
          color: "var(--text-secondary)",
        }}
      >
        <div
          className="font-semibold mb-1"
          style={{ color: "var(--text-primary)" }}
        >
          Context window
        </div>
        {hasContext && pct != null ? (
          <>
            <div className="mb-0.5">
              {pct}% used ({100 - pct}% left)
            </div>
            <div>
              {fmt(stats.totalTokens!)} / {fmt(stats.maxTokens!)} tokens
            </div>
          </>
        ) : (
          <div style={{ color: "var(--text-muted)" }}>Usage unavailable</div>
        )}
      </div>
    </div>
  );
}

/**
 * Compact collapsible summary of an AskUserQuestion answer turn. Shown
 * in place of the user's plain message bubble so the conversation keeps
 * a record of what was asked and answered without bloating the stream
 * with a giant markdown dump. Expanded by default (the user just saw
 * the questions) but collapsible via the header caret.
 */
function AskedQuestionsSummary({
  answers,
}: {
  answers: Array<{ question: string; value: string }>;
}) {
  const [expanded, setExpanded] = useState(true);
  const count = answers.length;
  return (
    <div className="my-5 px-1 flex flex-col gap-4">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-[14px] font-medium leading-none w-fit transition-colors"
        style={{
          color: "var(--text-secondary)",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
        }}
      >
        <span>
          Asked{" "}
          <span style={{ color: "var(--text-muted)" }}>
            {count} {count === 1 ? "question" : "questions"}
          </span>
        </span>
        <CaretDown
          size={12}
          weight="bold"
          style={{
            color: "var(--text-muted)",
            transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform 120ms ease",
          }}
        />
      </button>
      {expanded && (
        <div className="flex flex-col gap-4">
          {answers.map((a, i) => (
            <div key={i} className="flex flex-col gap-1">
              <span
                className="text-[14px] font-medium leading-snug"
                style={{ color: "var(--text-secondary)" }}
              >
                {a.question}
              </span>
              <span
                className="text-[14px] font-medium leading-snug"
                style={{ color: "var(--text-muted)" }}
              >
                {a.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageBlock({
  message,
  isStreaming,
  showHoverBar,
  onImageClick,
  onOpenFile,
}: {
  message: Message;
  isStreaming: boolean;
  showHoverBar: boolean;
  onImageClick?: (url: string) => void;
  onOpenFile?: (path: string) => void;
}) {
  if (message.collapsed) {
    return <CollapsedIndicator count={message.collapsed} />;
  }

  if (message.role === "tool_use") {
    return (
      <ToolUseIndicator
        toolName={message.toolName ?? "unknown"}
        toolInput={message.toolInput}
        onOpenFile={onOpenFile}
      />
    );
  }

  if (message.role === "plan") {
    // A `<proposed_plan>` block extracted from the assistant message
    // during history replay. Rendered as a read-only version of the
    // live approval card so refreshed threads match the interactive UI.
    return (
      <div className="my-3 max-w-[720px]">
        <PlanApprovalCard
          plan={message.content}
          planFilePath={message.planFilePath}
          onApprove={() => {}}
          onReject={() => {}}
          readOnly
        />
      </div>
    );
  }

  const isUser = message.role === "user";

  if (isUser) {
    // Answer to an AskUserQuestion — render as a collapsible summary
    // card left-aligned in the stream instead of the usual right-
    // aligned user bubble. The stream reads like a conversation log
    // of questions + answers rather than a wall of markdown.
    if (message.questionAnswers && message.questionAnswers.length > 0) {
      return <AskedQuestionsSummary answers={message.questionAnswers} />;
    }
    return (
      <div className="my-3 ml-auto w-fit max-w-[85%] min-w-0 group">
        {message.images && message.images.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-end mb-1.5">
            {message.images.map((img, i) => (
              <img
                key={i}
                src={img.url}
                alt="attachment"
                className="max-w-[260px] max-h-[200px] rounded-2xl object-cover cursor-pointer transition-opacity hover:opacity-80"
                style={{ border: "1px solid var(--border-default)" }}
                onClick={() => onImageClick?.(img.url)}
              />
            ))}
          </div>
        )}
        {message.content && (
          <div
            className="rounded-2xl px-5 py-3.5 text-[14px] leading-[1.6] font-medium break-words whitespace-pre-wrap"
            style={{
              background: "var(--surface-3)",
              color: "var(--text-primary)",
            }}
          >
            {message.content}
          </div>
        )}
        {showHoverBar && (
          <div className="flex justify-end px-1 transition-opacity duration-300 opacity-0 group-hover:opacity-100">
            <MessageHoverBar message={message} reverse />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="py-4 px-1">
      <div
        className="text-[14px] leading-[1.65] font-medium break-words min-w-0"
        style={{ color: "var(--text-primary)" }}
      >
        <StreamingText text={message.content} isStreaming={isStreaming} />
      </div>
      {message.fileChanges && message.fileChanges.length > 0 && (
        <FileChangeCard changes={message.fileChanges} onOpenFile={onOpenFile} />
      )}
    </div>
  );
}

/* ── Syntax highlighting theme (vivid on dark) ─── */
const codeTheme: Record<string, React.CSSProperties> = {
  'pre[class*="language-"]': {
    background: "transparent",
    margin: 0,
    padding: 0,
    overflow: "visible",
  },
  'code[class*="language-"]': {
    background: "transparent",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    lineHeight: "1.55",
    color: "#ced4e0",
  },
  comment: { color: "#5c6370", fontStyle: "italic" },
  prolog: { color: "#5c6370", fontStyle: "italic" },
  doctype: { color: "#5c6370" },
  cdata: { color: "#5c6370" },
  punctuation: { color: "#abb2bf" },
  property: { color: "#e06c75" },
  tag: { color: "#e06c75" },
  boolean: { color: "#d19a66" },
  number: { color: "#d19a66" },
  constant: { color: "#d19a66" },
  symbol: { color: "#56b6c2" },
  deleted: { color: "#e06c75" },
  selector: { color: "#98c379" },
  "attr-name": { color: "#e5c07b" },
  string: { color: "#98c379" },
  char: { color: "#98c379" },
  builtin: { color: "#e5c07b" },
  inserted: { color: "#98c379" },
  operator: { color: "#56b6c2" },
  entity: { color: "#56b6c2" },
  url: { color: "#56b6c2" },
  atrule: { color: "#c678dd" },
  "attr-value": { color: "#98c379" },
  keyword: { color: "#e06c75" },
  function: { color: "#e5c07b" },
  "class-name": { color: "#e5c07b" },
  regex: { color: "#56b6c2" },
  important: { color: "#e06c75", fontWeight: "bold" },
  variable: { color: "#ced4e0" },
  "template-string": { color: "#98c379" },
  interpolation: { color: "#ced4e0" },
  "template-punctuation": { color: "#98c379" },
  bold: { fontWeight: "bold" },
  italic: { fontStyle: "italic" },
};

/* ── Language display labels ─────────────────────────────────── */
const LANG_LABELS: Record<string, string> = {
  js: "JavaScript",
  jsx: "JSX",
  ts: "TypeScript",
  tsx: "TSX",
  py: "Python",
  python: "Python",
  rb: "Ruby",
  ruby: "Ruby",
  rs: "Rust",
  rust: "Rust",
  go: "Go",
  java: "Java",
  sh: "Shell",
  bash: "Bash",
  zsh: "Shell",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  sql: "SQL",
  md: "Markdown",
  markdown: "Markdown",
  dockerfile: "Dockerfile",
  graphql: "GraphQL",
  swift: "Swift",
  kotlin: "Kotlin",
  c: "C",
  cpp: "C++",
  "c++": "C++",
  csharp: "C#",
  "c#": "C#",
  php: "PHP",
  lua: "Lua",
  zig: "Zig",
  elixir: "Elixir",
  diff: "Diff",
  xml: "XML",
  txt: "Text",
  text: "Text",
};

// PERF: wrapped in React.memo so every unrelated ChatView re-render
// (attachment add/remove, status change, thread switch, etc.) doesn't force
// react-syntax-highlighter to re-tokenize every code block. Props are a
// plain string + string | undefined, so default shallow equality works.
const CodeBlock = memo(function CodeBlock({
  language,
  children,
}: {
  language: string | undefined;
  children: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard
      .writeText(children)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch((err) => {
        console.error("[Copy code block] clipboard write failed:", err);
      });
  }, [children]);

  const label = language ? (LANG_LABELS[language] ?? language) : null;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border-default)",
      }}
    >
      {/* Header: language label + copy icon */}
      <div className="flex items-center justify-between px-3 pt-2">
        <span
          className="text-[11px] font-medium"
          style={{ color: "rgba(255,255,255,0.35)" }}
        >
          {label ?? ""}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center rounded-lg p-1 -m-1 transition-colors cursor-pointer"
          style={{
            color: copied ? "#2EB67D" : "rgba(255,255,255,0.35)",
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            if (!copied) {
              e.currentTarget.style.color = "var(--text-primary)";
              e.currentTarget.style.background = "var(--surface-3)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = copied
              ? "#2EB67D"
              : "rgba(255,255,255,0.35)";
            e.currentTarget.style.background = "transparent";
          }}
          title="Copy code"
        >
          {copied ? (
            <Check size={14} weight="bold" />
          ) : (
            <Copy size={14} weight="regular" />
          )}
        </button>
      </div>
      {/* Highlighted code */}
      <div className="px-3 py-2 overflow-x-auto">
        <SyntaxHighlighter
          language={language ?? "text"}
          style={codeTheme}
          customStyle={{
            background: "transparent",
            margin: 0,
            padding: 0,
          }}
          codeTagProps={{
            style: {
              fontFamily: "var(--font-mono)",
              fontSize: "13px",
              lineHeight: "1.55",
            },
          }}
        >
          {children}
        </SyntaxHighlighter>
      </div>
    </div>
  );
});

function FileRefCode({ inner }: { inner: string }) {
  const ctx = useContext(OpenFileContext);
  const ref = parseFileRef(inner);
  if (!ctx || !ref) {
    return (
      <code
        className="font-mono text-[12.5px] font-semibold"
        style={{ color: "#6DC6FF" }}
      >
        {inner}
      </code>
    );
  }
  return (
    <code
      role="button"
      tabIndex={0}
      onClick={() => ctx.open(ref.path, ref.line)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          ctx.open(ref.path, ref.line);
        }
      }}
      title={`Open in ${ctx.editorLabel}`}
      className="font-mono text-[12.5px] font-semibold cursor-pointer hover:underline"
      style={{ color: "#6DC6FF" }}
    >
      {inner}
    </code>
  );
}

export function MarkdownContent({ text }: { text: string }) {
  const ctx = useContext(OpenFileContext);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
        strong: ({ children }) => (
          <strong
            className="font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {children}
          </strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        // Route every link click through `shell.openExternal` in the
        // main process. Without this override, two bad things happen:
        //
        //   1. `remark-gfm` autolinks bare URLs but the rendered `<a>`
        //      inherits zero styling, so they look like plain text.
        //   2. Default anchor clicks trigger an Electron webview
        //      navigation, which blows away the app UI and has no
        //      back button (main.ts has a belt-and-suspenders
        //      `will-navigate` guard for the same reason, but catching
        //      it here avoids the brief flash).
        //
        // We call `preventDefault` explicitly and ignore anything that
        // isn't http(s) — `openExternal` in main rejects non-http(s)
        // schemes anyway, but filtering here avoids the round-trip.
        a: ({ href, children }) => {
          const url = typeof href === "string" ? href : "";
          const isHttp = /^https?:\/\//i.test(url);
          const fileRef = parseFileRef(url);
          const isFileRef = !!ctx && !!fileRef;
          return (
            <a
              href={url || "#"}
              onClick={(e) => {
                e.preventDefault();
                if (isHttp && window.openclawdex?.openExternal) {
                  void window.openclawdex.openExternal(url);
                  return;
                }
                if (ctx && fileRef) {
                  ctx.open(fileRef.path, fileRef.line);
                }
              }}
              title={
                isHttp
                  ? `Open in browser: ${url}`
                  : isFileRef
                    ? `Open in ${ctx.editorLabel}`
                    : undefined
              }
              style={{
                color: isFileRef ? "#6DC6FF" : "var(--accent)",
                textDecoration: "underline",
                textUnderlineOffset: "2px",
                textDecorationThickness: "1px",
                textDecorationColor: isFileRef
                  ? "rgba(109, 198, 255, 0.35)"
                  : "rgba(51, 156, 255, 0.4)",
                cursor: isHttp || isFileRef ? "pointer" : "default",
              }}
            >
              {children}
            </a>
          );
        },
        // Images from model output. We do NOT auto-load arbitrary remote
        // URLs because:
        //
        //   1. Privacy / tracking: a rendered <img> is a GET to an attacker-
        //      chosen host that leaks the user's IP and a browser user-agent
        //      the moment it appears on screen. Classic "tracking pixel"
        //      surface when the model is prompted adversarially.
        //   2. Reliability: flaky image hosts (via.placeholder.com is a
        //      recurring offender) spam the console with TLS / connection
        //      errors every time the message re-renders.
        //
        // `data:` and `blob:` URLs are same-origin in spirit — they never
        // leave the renderer — so we allow those to render inline. Remote
        // http(s) images show a click-to-open chip that routes through
        // `openExternal`, the same path normal links already use, so the
        // image opens in the system browser where the user can decide.
        img: ({ src, alt }) => {
          const url = typeof src === "string" ? src : "";
          const isLocal = url.startsWith("data:") || url.startsWith("blob:");
          if (isLocal) {
            return (
              <img
                src={url}
                alt={alt ?? ""}
                style={{
                  maxWidth: "100%",
                  borderRadius: 8,
                  margin: "4px 0",
                  border: "1px solid var(--border-default)",
                }}
              />
            );
          }
          const isHttp = /^https?:\/\//i.test(url);
          const label = alt?.trim() || url || "image";
          return (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                if (isHttp && window.openclawdex?.openExternal) {
                  void window.openclawdex.openExternal(url);
                }
              }}
              title={isHttp ? `Open in browser: ${url}` : url}
              disabled={!isHttp}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[12px] align-baseline"
              style={{
                background: "rgba(255,255,255,0.06)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-default)",
                cursor: isHttp ? "pointer" : "default",
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              <ImageSquare size={12} weight="regular" />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {label}
              </span>
            </button>
          );
        },
        h1: ({ children }) => (
          <h1
            className="text-[17px] font-semibold mt-4 mb-2 first:mt-0"
            style={{ color: "var(--text-primary)" }}
          >
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2
            className="text-[15px] font-semibold mt-4 mb-2 first:mt-0"
            style={{ color: "var(--text-primary)" }}
          >
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3
            className="text-[14px] font-semibold mt-3 mb-1.5 first:mt-0"
            style={{ color: "var(--text-primary)" }}
          >
            {children}
          </h3>
        ),
        ul: ({ children }) => (
          <ul className="mb-3 last:mb-0 pl-5 space-y-1 list-disc">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-3 last:mb-0 pl-5 space-y-1 list-decimal">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="leading-[1.65]">{children}</li>,
        code: ({ children, className }) => {
          const codeString = String(children).replace(/\n$/, "");
          // Block code: has language class OR contains newlines (fenced block without lang)
          const hasLang = className?.includes("language-");
          const isBlock = hasLang || codeString.includes("\n");
          if (isBlock) {
            const language = hasLang
              ? className?.replace("language-", "")
              : undefined;
            return <CodeBlock language={language}>{codeString}</CodeBlock>;
          }
          const inner = String(children);
          if (parseFileRef(inner)) {
            return <FileRefCode inner={inner} />;
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
        pre: ({ children }) => <pre className="mb-3 last:mb-0">{children}</pre>,
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
          <hr
            className="my-3"
            style={{ borderColor: "var(--border-subtle)" }}
          />
        ),
        table: ({ children }) => (
          <div
            className="mb-3 last:mb-0 overflow-x-auto rounded-2xl"
            style={{ border: "2px solid var(--border-subtle)" }}
          >
            <table className="w-full text-[13px]">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead style={{ background: "rgba(255,255,255,0.06)" }}>
            {children}
          </thead>
        ),
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children }) => (
          <tr
            className="border-b-2 last:border-b-0"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            {children}
          </tr>
        ),
        th: ({ children }) => (
          <th
            className="px-3 py-2 text-left font-semibold border-r-2 last:border-r-0"
            style={{
              color: "var(--text-primary)",
              borderColor: "var(--border-subtle)",
            }}
          >
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td
            className="px-3 py-2 border-r-2 last:border-r-0"
            style={{
              color: "var(--text-secondary)",
              borderColor: "var(--border-subtle)",
            }}
          >
            {children}
          </td>
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
  onChange,
  onKeyDown,
  onPaste,
  disabled,
  placeholder,
  onClick,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  // Uncontrolled: the textarea owns its text. `onChange` is still fired so
  // the parent can track derived signals (e.g. "is the field empty?") without
  // round-tripping every keystroke through React state. See PERF note in
  // ChatView below.
  onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
  onPaste?: React.ClipboardEventHandler<HTMLTextAreaElement>;
  disabled?: boolean;
  placeholder?: string;
  onClick?: React.MouseEventHandler<HTMLTextAreaElement>;
}) {
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(
    null,
  );
  const [scrolling, setScrolling] = useState(false);
  const [hovered, setHovered] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateThumb = useCallback((el: HTMLTextAreaElement) => {
    const maxH = 140;
    if (el.scrollHeight <= maxH) {
      setThumb(null);
      return;
    }
    const ratio = maxH / el.scrollHeight;
    const height = Math.max(ratio * maxH, 24);
    const top = (el.scrollTop / el.scrollHeight) * maxH;
    setThumb({ height, top });
  }, []);

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLTextAreaElement>) => {
      updateThumb(e.currentTarget);
      setScrolling(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setScrolling(false), 1000);
    },
    [updateThumb],
  );

  const onThumbMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const el = textareaRef.current;
      if (!el || !thumb) return;
      const startY = e.clientY;
      const startScrollTop = el.scrollTop;
      const maxH = 140;
      const thumbRange = maxH - thumb.height;
      const scrollRange = el.scrollHeight - maxH;
      const onMove = (ev: MouseEvent) => {
        el.scrollTop =
          startScrollTop + ((ev.clientY - startY) / thumbRange) * scrollRange;
        updateThumb(el);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [textareaRef, thumb, updateThumb],
  );

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        disabled={disabled && !onClick}
        readOnly={disabled}
        onClick={onClick}
        onChange={onChange}
        onScroll={onScroll}
        onPaste={onPaste}
        onInput={(e) => {
          // Only keep the thumb in sync here — height auto-grow is handled
          // by CSS `field-sizing: content` below. Removing the imperative
          // height manipulation was critical for typing latency: each
          // `el.scrollHeight` read forced a synchronous full-page layout,
          // and we were doing three per keystroke. With field-sizing the
          // browser resizes the textarea without any JS round-trip.
          updateThumb(e.currentTarget);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? "Describe a task or ask a question"}
        rows={1}
        className="w-full bg-transparent text-[14px] font-medium px-4 pt-3 pb-1 resize-none outline-none placeholder:text-[var(--text-faint)] hide-native-scrollbar"
        style={
          {
            color: "var(--text-primary)",
            minHeight: "36px",
            maxHeight: "140px",
            // Native auto-grow (Chromium ≥123, we're on Electron 41 →
            // Chromium ≥136). Textarea sizes to its content, clamped by
            // min/max height, with the browser handling reflow.
            fieldSizing: "content",
            overflowY: "auto",
            scrollbarWidth: "none",
            cursor: disabled ? "default" : "text",
          } as React.CSSProperties
        }
      />
      {thumb && (
        <div
          className="absolute right-1 rounded-full cursor-pointer transition-opacity duration-300 pointer-events-auto"
          style={{
            top: thumb.top + 4,
            height: thumb.height - 8,
            width: 8,
            background: hovered
              ? "rgba(255,255,255,0.24)"
              : "rgba(255,255,255,0.14)",
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
  projects?: ProjectInfo[];
  projectCwd?: string;
  projectName?: string;
  isLoading?: boolean;
  onSend: (
    threadId: string,
    text: string,
    images?: ImagePayload[],
    opts?: { model?: string; effort?: string },
  ) => void;
  onInterrupt: (threadId: string) => void;
  onResolveRequest: (
    threadId: string,
    request: PendingRequest,
    payload: {
      answers: Record<string, string>;
      displayText: string;
      questionAnswers: Array<{ question: string; value: string }>;
    },
  ) => void;
  onCancelRequest: (threadId: string, request: PendingRequest) => void;
  /**
   * Approve (or reject) an ExitPlanMode plan. Fired from the
   * PlanApprovalCard that renders as a banner above the composer
   * when `thread.pendingRequest.kind` is `exit_plan_approval`. When
   * the user denies with a non-empty `message` (typed into the
   * composer textarea below the card), it's forwarded as the deny
   * reason so they can steer plan revisions in one shot.
   */
  onApprovePlan?: (
    threadId: string,
    request: PendingRequest,
    approved: boolean,
    message?: string,
  ) => void;
  /**
   * Approve / reject a per-tool approval prompt. When the user denies
   * with a non-empty `message`, it's forwarded to the agent as the
   * deny reason so they can steer the next step.
   */
  onApproveTool?: (
    threadId: string,
    request: PendingRequest,
    approved: boolean,
    message?: string,
  ) => void;
  /**
   * Flip the pending thread's provider when the user picks a Codex model
   * on a brand-new (uncommitted) conversation. No-op for already-started
   * threads — provider is frozen after session_init.
   */
  onUpdateThreadProvider?: (threadId: string, provider: Provider) => void;
  /** Reassign a thread to a different project (or null to ungroup). */
  onChangeThreadProject?: (threadId: string, projectId: string | null) => void;
  /**
   * Create a new project via the native folder picker and return it,
   * without spawning a new thread. Used by the in-hero project-switcher
   * so the current thread can be moved into a just-created project.
   */
  onCreateProject?: () => Promise<ProjectInfo | null>;
  /**
   * Kick off a new chat (resolves to a project via App.handleNewChat,
   * or opens the folder picker if no projects exist). Used by the
   * empty-app zero-state CTA.
   */
  onNewChat?: () => void;
  /**
   * Change the thread's UserMode. Renderer updates Thread state
   * optimistically; main.ts echoes a `mode_changed` IPC event back
   * to reconcile (including when the model itself flips mode via
   * `EnterPlanMode` / `ExitPlanMode`).
   */
  onSetMode?: (threadId: string, mode: UserMode) => void;
}

/* ── SendButton ──────────────────────────────────────────────
 *
 * PERF: the send button's "is there text?" signal used to live in
 * `hasText` state inside ChatView. Every bulk edit to the composer
 * (select-all + delete, undo of a paste, clearing on submit) flipped
 * that boolean and re-rendered the whole 3k-line ChatView — which
 * forced every CodeBlock / syntax-highlighted block to re-render.
 *
 * Pulling the state *inside* a dedicated leaf component keeps the
 * expensive parent tree still. The parent drives updates
 * imperatively via a ref; React.memo on CodeBlock (a separate change)
 * handles the still-possible re-renders from other causes.
 *
 * We intentionally don't pass `hasText` as a prop — that would defeat
 * the whole point, since a parent prop change means a parent render.
 */
export interface SendButtonHandle {
  setHasText: (hasText: boolean) => void;
}

const SendButton = forwardRef<
  SendButtonHandle,
  {
    hasAttachments: boolean;
    onClick: () => void;
    disabled?: boolean;
  }
>(function SendButton({ hasAttachments, onClick, disabled }, ref) {
  const [hasText, setHasText] = useState(false);
  useImperativeHandle(
    ref,
    () => ({
      setHasText(next: boolean) {
        // Functional updater bails out when unchanged — most keystrokes
        // within a non-empty draft (or within an empty one) no-op.
        setHasText((prev) => (prev === next ? prev : next));
      },
    }),
    [],
  );
  const active = !disabled && (hasText || hasAttachments);
  return (
    <button
      onClick={onClick}
      disabled={!active}
      className="w-[30px] h-[30px] flex items-center justify-center rounded-full transition-all"
      style={{
        background: active ? "var(--text-primary)" : "var(--surface-3)",
        color: active ? "var(--surface-0)" : "var(--text-faint)",
      }}
      onMouseEnter={(e) => {
        if (active) e.currentTarget.style.background = "rgba(255,255,255,0.85)";
      }}
      onMouseLeave={(e) => {
        if (active) e.currentTarget.style.background = "var(--text-primary)";
      }}
    >
      <ArrowUp size={16} weight="bold" />
    </button>
  );
});

export function ChatView({
  thread,
  projects,
  projectCwd,
  projectName,
  isLoading,
  onSend,
  onInterrupt,
  onResolveRequest,
  onCancelRequest,
  onApprovePlan,
  onApproveTool,
  onUpdateThreadProvider,
  onChangeThreadProject,
  onCreateProject,
  onNewChat,
  onSetMode,
}: ChatViewProps) {
  // PERF: the textarea is uncontrolled — its text lives in the DOM, read at
  // submit time via `textareaRef.current.value`. The "is there text?" signal
  // that drives the send-button style is kept *inside* SendButton (see its
  // definition above) and updated imperatively via this ref. That way even
  // hard flips (select-all + delete, undo a paste) don't re-render ChatView
  // or the message list — only the 30×30 send button.
  const sendButtonRef = useRef<SendButtonHandle>(null);
  const handleTextChange = useCallback<
    React.ChangeEventHandler<HTMLTextAreaElement>
  >((e) => {
    sendButtonRef.current?.setHasText(e.target.value.trim().length > 0);
  }, []);
  // GOTCHA: `selectedModel` is the unified picker state. When the user
  // picks a Codex model on a pending thread, we also call
  // `onUpdateThreadProvider` to flip the thread.provider so subsequent
  // handleSend routes to the Codex backend.
  //
  // Initial value: honour the persisted `lastSelection` if we already
  // have that provider's list cached (subsequent mounts in the same
  // app session). Previously this hardcoded Claude even when the user's
  // last session ended on Codex, producing a one-frame flash of the
  // wrong picker label before the sync effect corrected it.
  //
  // If no cache is available, we start `null` and the effect below
  // sets the real default once the first live list resolves.
  const [selectedModel, setSelectedModel] = useState<ModelDef | null>(() =>
    pickInitialModel(),
  );
  // Live Claude + Codex model lists, fetched from the respective
  // SDK/CLI on mount. Start from the module-level cache if a previous
  // mount already loaded them; otherwise empty until loadXxx resolves.
  const [claudeModels, setClaudeModels] = useState<ModelDef[]>(
    claudeModelsCache ?? [],
  );
  const [codexModels, setCodexModels] = useState<ModelDef[]>(
    codexModelsCache ?? [],
  );
  // CLI availability. `null` = not yet probed (optimistic — treat both
  // as available so we don't flash "Not installed" badges on launch).
  // Once resolved, the model picker greys out whichever provider's CLI
  // isn't on $PATH and surfaces an install hint next to the section
  // header. See preload.ts → session:check.
  const [providers, setProviders] = useState<{
    claude: boolean;
    codex: boolean;
  } | null>(null);
  useEffect(() => {
    loadClaudeModels().then(setClaudeModels);
    loadCodexModels().then(setCodexModels);
    window.openclawdex.checkProviders().then(setProviders);
  }, []);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  // GOTCHA: separate effort states per provider because the vocabularies
  // don't overlap (Codex has "minimal"/"xhigh" that Claude doesn't).
  // Effort is intentionally NOT persisted — it resets to the provider
  // default whenever the model changes (see the effect below).
  const [claudeEffort, setClaudeEffort] = useState<EffortDef>(CLAUDE_EFFORT[1]); // default "high"
  const [codexEffort, setCodexEffort] = useState<EffortDef>(CODEX_EFFORT[2]); // default "medium"
  const [effortDropdownOpen, setEffortDropdownOpen] = useState(false);
  const effortDropdownRef = useRef<HTMLDivElement>(null);
  // Mode is thread-scoped state owned by App.tsx. The dropdown reflects
  // `thread.userMode`, which reconciles on `mode_changed` events from
  // the backend (both UI-initiated switches and model-initiated
  // EnterPlanMode / ExitPlanMode calls). No local fallback state —
  // displaying anything other than the authoritative mode would lie.
  const selectedMode = modeById(thread?.userMode);
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const modeDropdownRef = useRef<HTMLDivElement>(null);
  const [editorDropdownOpen, setEditorDropdownOpen] = useState(false);
  const [editorDropdownPos, setEditorDropdownPos] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const editorCaretRef = useRef<HTMLButtonElement>(null);
  const [preferredEditor, setPreferredEditor] = useState<EditorTarget>(() => {
    const stored = localStorage.getItem("preferredEditor");
    if (stored && isEditorTarget(stored)) return stored;
    return "vscode";
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<ScrollAreaHandle>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const isAtBottomRef = useRef(true);
  // PERF/UX: during streaming, new tokens grow scrollHeight while the smooth
  // auto-scroll is still animating scrollTop toward the new bottom. That
  // creates brief windows where the "at bottom" math reports false, which
  // used to flip the scroll-to-bottom button on for a frame or two and then
  // off again — visible flicker. We debounce the "show" transition so only
  // sustained "not at bottom" (i.e. the user actually scrolled up) surfaces
  // the button. Hiding stays instant.
  const showScrollBtnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const currentThreadIdRef = useRef<string | undefined>(undefined);
  const prevHistoryLoadedRef = useRef<boolean | undefined>(undefined);

  // ── Image lightbox ──────────────────────────────────────────
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // ── Image attachments ──────────────────────────────────────
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);
  // GOTCHA: the dragenter/dragleave counter occasionally gets stranded
  // above zero — the drag can end without a matching leave (Escape
  // mid-drag, drop on the macOS title bar's `-webkit-app-region: drag`
  // zone, drop outside the window). When that happens the overlay
  // stays stuck visible. We recover with a heartbeat: every
  // `dragover` refreshes this timer, and if nothing refreshes it
  // within ~150ms we assume the drag is over.
  const dragClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const resetDragState = useCallback(() => {
    dragCounter.current = 0;
    if (dragClearTimer.current) {
      clearTimeout(dragClearTimer.current);
      dragClearTimer.current = null;
    }
    setIsDragOver(false);
  }, []);

  // Belt-and-braces: listen at the window level for drag-end signals
  // the nested counter can miss. Only armed while the overlay is
  // actually showing so we don't keep global listeners for no reason.
  useEffect(() => {
    if (!isDragOver) return;
    const onDone = () => resetDragState();
    const onWindowDragLeave = (e: DragEvent) => {
      // dragleave at (0,0) is Chromium's signal that the pointer
      // crossed the window boundary.
      if (e.clientX === 0 && e.clientY === 0) resetDragState();
    };
    window.addEventListener("drop", onDone);
    window.addEventListener("dragend", onDone);
    window.addEventListener("dragleave", onWindowDragLeave);
    return () => {
      window.removeEventListener("drop", onDone);
      window.removeEventListener("dragend", onDone);
      window.removeEventListener("dragleave", onWindowDragLeave);
    };
  }, [isDragOver, resetDragState]);

  useEffect(() => {
    return () => {
      if (dragClearTimer.current) clearTimeout(dragClearTimer.current);
    };
  }, []);

  // Clear attachments when switching threads
  useEffect(() => {
    setAttachments((prev) => {
      prev.forEach((a) => URL.revokeObjectURL(a.previewUrl));
      return [];
    });
  }, [thread?.id]);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const images = Array.from(files).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (images.length === 0) return;
      const newAttachments: ImageAttachment[] = images.map((file) => ({
        id: crypto.randomUUID(),
        file,
        name: file.name,
        previewUrl: URL.createObjectURL(file),
      }));
      setAttachments((prev) => [...prev, ...newAttachments]);
    },
    [thread?.provider],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const removed = prev.find((a) => a.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  // Drag handlers
  const bumpHeartbeat = useCallback(() => {
    if (dragClearTimer.current) clearTimeout(dragClearTimer.current);
    dragClearTimer.current = setTimeout(() => {
      dragClearTimer.current = null;
      resetDragState();
    }, 150);
  }, [resetDragState]);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current++;
      if (e.dataTransfer.types.includes("Files")) {
        setIsDragOver(true);
        bumpHeartbeat();
      }
    },
    [bumpHeartbeat],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Every dragover refreshes the heartbeat. When the drag really
      // ends (drop, escape, leave window) these stop firing and the
      // timer elapses, clearing the overlay even if dragleave didn't
      // match up.
      bumpHeartbeat();
    },
    [bumpHeartbeat],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current--;
      if (dragCounter.current <= 0) {
        resetDragState();
      }
    },
    [resetDragState],
  );

  // Format a dropped path as a chat-ready reference.
  //
  // When the dropped path lives inside `projectCwd` we emit a relative
  // `@<path>` token — that's the convention both the Claude and Codex
  // CLIs understand for "please read this file/folder". Paths outside
  // the project (or when there's no cwd yet, e.g. a brand-new thread)
  // come through as plain absolute paths, which the agent can still
  // resolve but won't get the @-expansion treatment.
  const formatPathRef = useCallback(
    (absPath: string): string => {
      if (!projectCwd) return absPath;
      const cwd = projectCwd.replace(/\/+$/, "");
      if (absPath === cwd) return "@.";
      if (absPath.startsWith(cwd + "/"))
        return "@" + absPath.slice(cwd.length + 1);
      return absPath;
    },
    [projectCwd],
  );

  // Insert text at the textarea's current caret, adding surrounding
  // spaces only where needed so dropped refs don't fuse with adjacent
  // tokens.
  //
  // GOTCHA: the textarea is uncontrolled (see SendButton's PERF note),
  // so a plain `el.value = ...` assignment skips React's synthetic
  // event pipeline — `onChange` doesn't fire and any consumer that
  // depends on it (today: SendButton's "has text" flag; tomorrow:
  // anything else we wire up) silently desyncs. The standard fix is
  // to call the prototype's value setter and dispatch a bubbling
  // `input` event, which React picks up and routes through
  // `handleTextChange` exactly as if the user had typed.
  const insertAtCursor = useCallback((text: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    const needsLead = before.length > 0 && !/\s$/.test(before);
    const needsTrail = after.length === 0 || !/^\s/.test(after);
    const insertion = (needsLead ? " " : "") + text + (needsTrail ? " " : "");
    const nextValue = before + insertion + after;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (setter) setter.call(el, nextValue);
    else el.value = nextValue; // pathological fallback; never seen in Chromium
    el.dispatchEvent(new Event("input", { bubbles: true }));
    const caret = before.length + insertion.length;
    el.setSelectionRange(caret, caret);
    el.focus();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resetDragState();

      // Partition the drop into two buckets:
      //   - images → attach as previews (current behavior)
      //   - everything else (non-image files AND directories) → insert
      //     an @-reference so the agent can read/list it.
      //
      // GOTCHA: `webkitGetAsEntry()` is the only synchronous way to
      // tell a directory from an empty file in the renderer. It MUST be
      // called during the drop event — the items become inert after we
      // return. We call it upfront and stash the results.
      const items = Array.from(e.dataTransfer.items ?? []);
      const imageFiles: File[] = [];
      const pathRefs: string[] = [];

      const pushPath = (file: File | null) => {
        if (!file) return;
        const abs = window.openclawdex?.getFilePath?.(file);
        if (abs) pathRefs.push(formatPathRef(abs));
      };

      if (items.length > 0) {
        for (const item of items) {
          if (item.kind !== "file") continue;
          const entry = item.webkitGetAsEntry?.();
          const file = item.getAsFile();
          if (entry?.isDirectory) {
            pushPath(file);
          } else if (file && file.type.startsWith("image/")) {
            imageFiles.push(file);
          } else {
            pushPath(file);
          }
        }
      } else {
        // Fallback for drops that didn't populate `items` (rare, but
        // some sources only fill `files`). We can't detect folders
        // here, but `getFilePath` still returns the OS path for both.
        for (const f of Array.from(e.dataTransfer.files)) {
          if (f.type.startsWith("image/")) imageFiles.push(f);
          else pushPath(f);
        }
      }

      if (imageFiles.length > 0) addFiles(imageFiles);
      if (pathRefs.length > 0) insertAtCursor(pathRefs.join(" "));
    },
    [addFiles, formatPathRef, insertAtCursor, resetDragState],
  );

  // Paste handler for images
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        addFiles(imageFiles);
      }
    },
    [addFiles],
  );

  const handleMessagesScroll = useCallback((el: HTMLDivElement) => {
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    isAtBottomRef.current = atBottom;
    if (atBottom) {
      // Hide immediately — no flicker risk, and snappy when the user jumps
      // back to the bottom.
      if (showScrollBtnTimerRef.current) {
        clearTimeout(showScrollBtnTimerRef.current);
        showScrollBtnTimerRef.current = null;
      }
      setShowScrollBtn(false);
    } else if (!showScrollBtnTimerRef.current) {
      // Delay showing. If we return to bottom before the timer fires (as
      // happens mid smooth-scroll during streaming), the timer is cancelled
      // above and the button never appears.
      showScrollBtnTimerRef.current = setTimeout(() => {
        showScrollBtnTimerRef.current = null;
        if (!isAtBottomRef.current) setShowScrollBtn(true);
      }, 180);
    }
  }, []);

  // Scroll to bottom: instant on thread switch or history load, smooth for new messages
  useLayoutEffect(() => {
    const threadChanged = thread?.id !== currentThreadIdRef.current;
    const historyJustLoaded =
      !threadChanged &&
      !!thread?.historyLoaded &&
      !prevHistoryLoadedRef.current;

    currentThreadIdRef.current = thread?.id;
    prevHistoryLoadedRef.current = thread?.historyLoaded;

    if (threadChanged || historyJustLoaded) {
      isAtBottomRef.current = true;
      if (showScrollBtnTimerRef.current) {
        clearTimeout(showScrollBtnTimerRef.current);
        showScrollBtnTimerRef.current = null;
      }
      setShowScrollBtn(false);
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
    } else if (isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    // `pendingRequest?.kind` is included so the "Asking questions…"
    // indicator (rendered below the message list when a pending
    // AskUserQuestion lands) triggers the same autoscroll as a new
    // message would — otherwise it appears off-screen.
  }, [thread?.id, thread?.historyLoaded, thread?.messages, thread?.pendingRequest?.kind]);

  // Autofocus composer when thread changes
  useEffect(() => {
    if (thread?.id) {
      textareaRef.current?.focus();
    }
  }, [thread?.id]);

  // Clear any pending scroll-button timer on unmount.
  useEffect(() => {
    return () => {
      if (showScrollBtnTimerRef.current) {
        clearTimeout(showScrollBtnTimerRef.current);
        showScrollBtnTimerRef.current = null;
      }
    };
  }, []);

  const handleSubmit = async () => {
    const text = (textareaRef.current?.value ?? "").trim();
    const hasContent = text.length > 0 || attachments.length > 0;
    if (!thread) return;

    // An approval is pending: the composer is acting as a "deny with
    // feedback" channel. Send routes the typed message to the matching
    // handler as a deny note, and we never call onSend. Empty text +
    // Enter falls through to a no-op (let the user click the explicit
    // Deny / Allow buttons in the banner above).
    const pending = thread.pendingRequest;
    if (pending?.kind === "tool_approval") {
      if (!text) return;
      onApproveTool?.(thread.id, pending, false, text);
      const el = textareaRef.current;
      if (el) el.value = "";
      sendButtonRef.current?.setHasText(false);
      return;
    }
    if (pending?.kind === "exit_plan_approval") {
      if (!text) return;
      onApprovePlan?.(thread.id, pending, false, text);
      const el = textareaRef.current;
      if (el) el.value = "";
      sendButtonRef.current?.setHasText(false);
      return;
    }

    if (!hasContent || thread.status === "running") return;

    // Convert attachments to base64. If the File was sourced from the
    // OS (drag-drop), Electron can resolve its real path — we pass that
    // through so the Codex backend can use it directly without
    // materializing a tempfile. Clipboard-paste files have no backing
    // path, so `path` stays undefined for those.
    //
    // GOTCHA: Electron 32 removed the legacy `File.path` property.
    // `window.openclawdex.getFilePath()` wraps `webUtils.getPathForFile`
    // in the preload, which is the supported replacement.
    let images: ImagePayload[] | undefined;
    if (attachments.length > 0) {
      images = await Promise.all(
        attachments.map(
          (a) =>
            new Promise<ImagePayload>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result as string;
                // Strip the data:image/xxx;base64, prefix
                const base64 = dataUrl.split(",")[1];
                const osPath = window.openclawdex?.getFilePath?.(a.file);
                resolve({
                  name: a.name,
                  base64,
                  mediaType: a.file.type,
                  ...(osPath && { path: osPath }),
                });
              };
              reader.readAsDataURL(a.file);
            }),
        ),
      );
    }

    const effort =
      thread.provider === "codex" ? codexEffort.id : claudeEffort.id;
    // `selectedModel` can be null during the brief window before the
    // live model list arrives. Omit the model field so the backend
    // falls back to the CLI's own default for the provider.
    onSend(thread.id, text, images, {
      ...(selectedModel && { model: selectedModel.id }),
      effort,
    });
    // Clear the uncontrolled textarea + flip the send-button state.
    // `field-sizing: content` on the element handles the reflow.
    const el = textareaRef.current;
    if (el) el.value = "";
    sendButtonRef.current?.setHasText(false);
    setAttachments((prev) => {
      prev.forEach((a) => URL.revokeObjectURL(a.previewUrl));
      return [];
    });
  };

  const handleOpenInEditor = useCallback(
    (target: string, line?: number, editor?: EditorTarget) => {
      const effective = editor ?? preferredEditor;
      window.openclawdex
        ?.openInEditor(target, projectCwd, line, effective)
        .then((res) => {
          if (!res.ok && res.message) {
            // Fall back to a native alert; no toast infra yet.
            alert(res.message);
          }
        })
        .catch((err) => {
          console.error("[Open in editor] failed:", err);
          const msg = err instanceof Error ? err.message : String(err);
          alert(`Open in editor failed: ${msg}`);
        });
    },
    [projectCwd, preferredEditor],
  );

  useEffect(() => {
    if (!modelDropdownOpen && !effortDropdownOpen && !modeDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        modelDropdownOpen &&
        modelDropdownRef.current &&
        !modelDropdownRef.current.contains(e.target as Node)
      ) {
        setModelDropdownOpen(false);
      }
      if (
        effortDropdownOpen &&
        effortDropdownRef.current &&
        !effortDropdownRef.current.contains(e.target as Node)
      ) {
        setEffortDropdownOpen(false);
      }
      if (
        modeDropdownOpen &&
        modeDropdownRef.current &&
        !modeDropdownRef.current.contains(e.target as Node)
      ) {
        setModeDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [modelDropdownOpen, effortDropdownOpen, modeDropdownOpen]);

  // Keep `selectedModel` in sync with whichever provider's list
  // matches the current thread. Fires in three cases:
  //   - First mount, no cached list yet: selectedModel is null →
  //     restore the last-used model for this provider from
  //     localStorage, or fall back to the list head.
  //   - Thread switch crosses providers: selectedModel belongs to
  //     the other provider → swap to the current provider's saved
  //     model (or list head).
  //   - Live list replaces a stale entry: selectedModel's id isn't
  //     in the list anymore → fall back to the list head.
  useEffect(() => {
    if (!thread) return;
    const raw = localStorage.getItem("lastSelection");
    const saved = raw
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : null;
    const savedProvider: Provider | undefined =
      saved?.provider === "claude" || saved?.provider === "codex"
        ? saved.provider
        : undefined;
    // For a pending thread, honour whatever provider was last picked by
    // flipping thread.provider if needed. Started threads are locked.
    const isPending =
      thread.messages.length === 0 && thread.sessionId === undefined;
    const targetProvider =
      isPending && savedProvider ? savedProvider : thread.provider;
    const list = targetProvider === "claude" ? claudeModels : codexModels;
    if (list.length === 0) return;
    const ok =
      selectedModel &&
      selectedModel.provider === targetProvider &&
      list.some((m) => m.id === selectedModel.id);
    if (isPending && targetProvider !== thread.provider) {
      onUpdateThreadProvider?.(thread.id, targetProvider);
    }
    if (ok) return;
    const restored = saved?.modelId
      ? list.find((m) => m.id === saved.modelId)
      : undefined;
    setSelectedModel(restored ?? list[0]);
  }, [
    thread,
    selectedModel,
    claudeModels,
    codexModels,
    onUpdateThreadProvider,
  ]);

  // Restore the effort for the current provider whenever the selected model changes.
  useEffect(() => {
    if (!selectedModel || !thread) return;
    const raw = localStorage.getItem("lastSelection");
    const saved = raw
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : null;
    const base = thread.provider === "codex" ? CODEX_EFFORT : CLAUDE_EFFORT;
    const fallback =
      thread.provider === "codex" ? CODEX_EFFORT[2] : CLAUDE_EFFORT[1];
    const restored = base.find((e) => e.id === saved?.effortId) ?? fallback;
    if (thread.provider === "codex") setCodexEffort(restored);
    else setClaudeEffort(restored);
  }, [selectedModel?.id, thread?.provider]);

  // Auto-correct the selected effort when the model changes to one
  // that doesn't support it (e.g. Opus's "xhigh" → Sonnet has no
  // "xhigh"). Lives above the early return below so the hook order
  // stays stable when `thread` flips between null and non-null.
  useEffect(() => {
    if (!thread) return;
    const picked =
      selectedModel?.provider === thread.provider
        ? selectedModel
        : thread.provider === "claude"
          ? claudeModels[0]
          : codexModels[0];
    if (!picked) return;
    const isCodexThread = thread.provider === "codex";
    const base = isCodexThread ? CODEX_EFFORT : CLAUDE_EFFORT;
    const list =
      picked.supportedEfforts === undefined
        ? base
        : base.filter((e) => picked.supportedEfforts!.includes(e.id));
    if (list.length === 0) return;
    const current = isCodexThread ? codexEffort : claudeEffort;
    const setCurrent = isCodexThread ? setCodexEffort : setClaudeEffort;
    if (list.find((e) => e.id === current.id)) return;
    const fallback =
      list.find((e) => e.id === "high") ?? list[Math.floor(list.length / 2)];
    if (fallback) setCurrent(fallback);
  }, [
    thread,
    selectedModel,
    claudeModels,
    codexModels,
    claudeEffort,
    codexEffort,
  ]);

  if (!thread) {
    // Two no-thread states:
    //   1. Loading — spinner while bootstrap is in flight.
    //   2. No projects exist at all — zero-state hero with a CTA
    //      that opens the folder picker via handleNewChat.
    // A third case (thread deselected while projects exist) is
    // handled by an effect in App.tsx that auto-spawns a pending
    // thread, so it never reaches this render.
    return (
      <div className="flex-1 flex flex-col min-h-0 px-8 pt-10 pb-4 relative">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              className="animate-spin"
              style={{ color: "var(--text-muted)" }}
            >
              <circle
                cx="10"
                cy="10"
                r="8"
                stroke="currentColor"
                strokeWidth="2"
                strokeOpacity="0.2"
              />
              <path
                d="M10 2a8 8 0 0 1 8 8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
        ) : (projects?.length ?? 0) === 0 ? (
          <div
            className="flex-1 flex items-center justify-center px-8 text-center"
            style={{ animation: "fadeIn 120ms ease" }}
          >
            <div className="relative px-8 py-7 mb-18">
              <div
                className="text-[28px] font-medium tracking-tight leading-tight"
                style={{ color: "var(--text-muted)" }}
              >
                What are we building today?
              </div>
              {onNewChat && (
                <button
                  onClick={onNewChat}
                  className="mt-6 flex items-center gap-1.5 pl-3 pr-4 py-[10px] rounded-full text-[13px] font-medium transition-colors z-10 mx-auto"
                  style={{
                    background: "#ffffff",
                    color: "#181818",
                    boxShadow: "0 8px 30px rgba(0,0,0,0.28)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background =
                      "rgba(255, 255, 255, 0.88)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#ffffff";
                  }}
                >
                  <Plus size={15} weight="bold" />
                  Add a project
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  const isClaude = thread.provider === "claude";
  const isCodex = thread.provider === "codex";
  // A "pending" thread hasn't been committed to the DB yet — no
  // session_init has fired, so no sessionId. Only pending threads can
  // have their model/provider changed; committed threads have a real
  // server-side session and changing the model retroactively doesn't
  // make sense. (`isStarted` alone isn't enough because a committed
  // thread whose history hasn't loaded yet also has messages.length=0.)
  const isStarted =
    thread.messages.length > 0 || thread.sessionId !== undefined;

  // Both CLIs missing → no agent to pick a model/effort for, and no
  // reason to show a composer. We swap the entire composer for two
  // prominent install links. We require both flags to be explicitly
  // `false` — `null` means we haven't probed yet and we don't want to
  // flash install links at launch.
  const bothMissing = providers?.claude === false && providers?.codex === false;

  // If the currently-selected model doesn't match the thread's
  // provider (e.g. thread is Codex but we still have Claude Opus
  // picked from the previous thread), fall back to the first model
  // of the thread's provider so the label doesn't lie. May be null
  // while the live list is still loading.
  const displayedModel: ModelDef | null =
    selectedModel && selectedModel.provider === thread.provider
      ? selectedModel
      : ((isClaude ? claudeModels[0] : codexModels[0]) ?? null);
  const modelLabel = displayedModel?.label ?? "Loading models…";
  const baseEffortList = isCodex ? CODEX_EFFORT : CLAUDE_EFFORT;
  // Filter the provider's full effort list down to the ones the
  // selected model supports. While no model is resolved yet, show
  // the full base list so the picker isn't empty.
  const effortList =
    !displayedModel || displayedModel.supportedEfforts === undefined
      ? baseEffortList
      : baseEffortList.filter((e) =>
          displayedModel.supportedEfforts!.includes(e.id),
        );
  const selectedEffort = isCodex ? codexEffort : claudeEffort;
  const setSelectedEffort = isCodex ? setCodexEffort : setClaudeEffort;
  // Hide the effort picker entirely for models that don't support
  // reasoning control (e.g. Claude Haiku).
  const showEffortPicker = effortList.length > 0;

  return (
    <OpenFileContext.Provider
      value={{
        open: handleOpenInEditor,
        editorLabel: editorLabel(preferredEditor),
      }}
    >
      <div
        className="flex-1 flex flex-col min-w-0 min-h-0 relative"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Full-area drop overlay — shown whenever the user is dragging
            files anywhere over the chat (messages list + composer),
            not just the input box. `pointer-events-none` keeps drag
            events flowing to the parent's handlers so the drop still
            registers.
            Border-radius: left side matches the panel's 16px inner
            rounding; right side is rounded to ~10px to echo the macOS
            window's native corner radius (the panel itself is flush
            right against the window edge, so a square right border
            gets clipped by the OS corner). A 6px inset keeps the
            dashed line comfortably inside the visible area regardless
            of minor platform variation. */}
        {isDragOver && (
          <div
            className="absolute z-20 flex items-center justify-center pointer-events-none"
            style={{
              top: 6,
              bottom: 6,
              left: 6,
              right: 6,
              background: "rgba(10, 12, 16, 0.55)",
              backdropFilter: "blur(2px)",
              WebkitBackdropFilter: "blur(2px)",
              border: "2px dashed rgba(255, 255, 255, 0.35)",
              borderRadius: "12px 8px 8px 12px",
            }}
          >
            <span
              className="text-[13px] font-medium px-3 py-1.5 rounded-lg"
              style={{
                background: "var(--surface-3)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-emphasis)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              }}
            >
              Drop files or folders
            </span>
          </div>
        )}
        {/* Title bar area */}
        <div
          className="h-[38px] shrink-0 flex items-center justify-center relative"
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
          {projectCwd && (
            <div
              className="absolute right-3 top-1/2 -translate-y-1/2"
              style={{
                // @ts-expect-error -- webkit
                WebkitAppRegion: "no-drag",
              }}
            >
              <div
                className="inline-flex items-stretch h-[26px] rounded-xl overflow-hidden"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border-default)",
                }}
              >
                <button
                  onClick={() =>
                    handleOpenInEditor(projectCwd, undefined, preferredEditor)
                  }
                  title={`Open project in ${editorLabel(preferredEditor)}`}
                  className="flex items-center justify-center pl-2.5 pr-1 transition-colors"
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "rgba(255,255,255,0.06)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <EditorTargetIcon target={preferredEditor} size={16} />
                </button>
                <button
                  ref={editorCaretRef}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!editorDropdownOpen && editorCaretRef.current) {
                      const rect =
                        editorCaretRef.current.getBoundingClientRect();
                      setEditorDropdownPos({
                        top: rect.bottom + 4,
                        right: window.innerWidth - rect.right,
                      });
                    }
                    setEditorDropdownOpen((v) => !v);
                  }}
                  title="Open project in…"
                  className="flex items-center justify-center pl-1 pr-2 transition-colors"
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "rgba(255,255,255,0.06)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <CaretDown
                    size={12}
                    weight="bold"
                    style={{ color: "var(--text-muted)" }}
                  />
                </button>
              </div>
              {editorDropdownOpen &&
                editorDropdownPos &&
                createPortal(
                  <>
                    <div
                      className="fixed inset-0 z-[60]"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditorDropdownOpen(false);
                      }}
                    />
                    <OpenInEditorDropdown
                      top={editorDropdownPos.top}
                      right={editorDropdownPos.right}
                      onSelect={(editor) => {
                        setEditorDropdownOpen(false);
                        setPreferredEditor(editor);
                        localStorage.setItem("preferredEditor", editor);
                        handleOpenInEditor(projectCwd, undefined, editor);
                      }}
                    />
                  </>,
                  document.body,
                )}
            </div>
          )}
        </div>

        {/* Messages */}
        <ScrollArea
          ref={scrollAreaRef}
          className="flex-1"
          onScroll={handleMessagesScroll}
        >
          {thread.messages.length === 0 && thread.historyLoaded ? (
            <div
              key={thread.id}
              className="flex items-center justify-center h-full px-8"
              style={{ animation: "fadeIn 120ms ease" }}
            >
              <div
                className="text-[28px] font-medium tracking-tight text-center leading-tight"
                style={{ color: "var(--text-muted)" }}
              >
                {projectName && thread ? (
                  <>
                    What are we building in
                    <ProjectNameDropdown
                      projectName={projectName}
                      projects={projects ?? []}
                      currentProjectId={thread.projectId}
                      onSelect={(pid) => {
                        if (pid !== thread.projectId) {
                          onChangeThreadProject?.(thread.id, pid);
                        }
                      }}
                      onCreateNew={async () => {
                        if (!onCreateProject) return;
                        const created = await onCreateProject();
                        if (created)
                          onChangeThreadProject?.(thread.id, created.id);
                      }}
                    />
                    ?
                  </>
                ) : (
                  "What are we building today?"
                )}
              </div>
            </div>
          ) : (
            <div
              key={`${thread.id}-${thread.historyLoaded}`}
              className="max-w-[720px] mx-auto px-5 pt-3 pb-16"
              style={{ animation: "fadeIn 120ms ease" }}
            >
              {(() => {
                const msgs = thread.messages;
                const rendered: React.ReactNode[] = [];
                // ID of the last assistant message (for streaming indicator)
                const streamingMsgId =
                  thread.status === "running" &&
                  msgs[msgs.length - 1]?.role === "assistant"
                    ? msgs[msgs.length - 1].id
                    : null;

                let i = 0;
                while (i < msgs.length) {
                  const msg = msgs[i];

                  if (msg.collapsed || msg.role === "user") {
                    rendered.push(
                      <MessageBlock
                        key={msg.id}
                        message={msg}
                        isStreaming={false}
                        showHoverBar={msg.role === "user"}
                        onImageClick={setLightboxUrl}
                        onOpenFile={handleOpenInEditor}
                      />,
                    );
                    i++;
                  } else {
                    // Collect full assistant turn (assistant + tool_use messages)
                    const turnStart = i;
                    while (
                      i < msgs.length &&
                      (msgs[i].role === "assistant" ||
                        msgs[i].role === "tool_use" ||
                        msgs[i].role === "plan")
                    ) {
                      i++;
                    }
                    const turnMsgs = msgs.slice(turnStart, i);

                    // Find the last assistant message for the hover bar
                    const lastAssistantMsg = turnMsgs.reduce<
                      Message | undefined
                    >(
                      (last, m) => (m.role === "assistant" ? m : last),
                      undefined,
                    );
                    // Plan messages carry the real content when the
                    // assistant message was entirely a `<proposed_plan>`
                    // block (we strip it out during history parsing).
                    // Prefer the plan for the copy button so it actually
                    // copies something meaningful; fall back to any
                    // surrounding prose otherwise.
                    const lastPlanMsg = turnMsgs.reduce<
                      Message | undefined
                    >(
                      (last, m) => (m.role === "plan" ? m : last),
                      undefined,
                    );
                    const hoverBarMsg = lastPlanMsg ?? lastAssistantMsg;
                    // The last *visible* message in the turn determines the
                    // hover bar's top margin: assistant text has `py-4`, so
                    // we overlap it with `-mt-4`; tool rows only have `py-1.5`,
                    // so that negative margin would crowd the bar against the
                    // tool name.
                    const lastVisibleMsg = [...turnMsgs]
                      .reverse()
                      .find(
                        (m) =>
                          !(
                            m.role === "tool_use" &&
                            m.toolName === "AskUserQuestion"
                          ),
                      );
                    const endsWithToolUse =
                      lastVisibleMsg?.role === "tool_use";
                    const endsWithPlan = lastVisibleMsg?.role === "plan";
                    // Turn is complete if there are more messages after it, or thread is idle
                    const isTurnComplete =
                      i < msgs.length || thread.status === "idle";

                    rendered.push(
                      <div key={`turn-${msg.id}`} className="group/turn">
                        {turnMsgs.map((m) => {
                          // AskUserQuestion is surfaced via the questionnaire
                          // composer (see QuestionnaireComposer), not as a
                          // card in the stream. Skip it here — the structured
                          // user answer that follows (rendered as chip pills)
                          // is the visual record of the exchange.
                          if (
                            m.role === "tool_use" &&
                            m.toolName === "AskUserQuestion"
                          ) {
                            return null;
                          }
                          return (
                            <MessageBlock
                              key={m.id}
                              message={m}
                              isStreaming={m.id === streamingMsgId}
                              showHoverBar={false}
                              onImageClick={setLightboxUrl}
                              onOpenFile={handleOpenInEditor}
                            />
                          );
                        })}
                        {hoverBarMsg && isTurnComplete && (
                          <div
                            className={`${endsWithPlan ? "mt-3" : endsWithToolUse ? "mt-1" : "-mt-4"} px-1 transition-opacity duration-300 opacity-0 group-hover/turn:opacity-100`}
                          >
                            <MessageHoverBar message={hoverBarMsg} />
                          </div>
                        )}
                      </div>,
                    );
                  }
                }
                return rendered;
              })()}
              {thread.pendingRequest?.kind === "ask_user_question" ? (
                <div className="py-4 px-1">
                  <ThinkingIndicator label="Asking questions…" />
                </div>
              ) : thread.pendingRequest?.kind === "exit_plan_approval" ? (
                <div className="py-4 px-1">
                  <ThinkingIndicator label="Awaiting plan approval…" />
                </div>
              ) : thread.pendingRequest?.kind === "tool_approval" ? (
                <div className="py-4 px-1">
                  <ThinkingIndicator label="Awaiting approval…" />
                </div>
              ) : (
                // Show "Thinking…" whenever the thread is running and we're
                // not in a pending-request state. We used to suppress this
                // when the last message was an assistant message (the
                // streaming text was acting as the indicator), but that
                // left a silent gap between the assistant finishing its
                // text and the next tool event arriving — exactly when the
                // model is deciding to call AskUserQuestion / ExitPlanMode
                // and the user can't tell anything is happening.
                thread.status === "running" && (
                  <div className="py-4 px-1">
                    <ThinkingIndicator />
                  </div>
                )
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
          {bothMissing ? (
            // No agent CLI on $PATH — there's literally nothing the
            // composer can do, so we replace the whole input affordance
            // with two prominent install links. Sits in the same bottom
            // slot so the user's eyes don't have to hunt.
            <div className="max-w-[720px] mx-auto flex items-center justify-center gap-2.5 py-3">
              <InstallPromptButton
                provider="claude"
                label="Install Claude Code CLI"
                url="https://code.claude.com/docs/en/quickstart#before-you-begin"
              />
              <InstallPromptButton
                provider="codex"
                label="Install Codex CLI"
                url="https://developers.openai.com/codex/quickstart?setup=cli"
              />
            </div>
          ) : thread.pendingRequest?.kind === "ask_user_question" ? (
            // Agent is paused waiting on an AskUserQuestion. Swap the
            // whole input affordance for the questionnaire so the user
            // can't type free-form text into a turn that's waiting on a
            // structured answer. Footer (Local / branch / context) stays
            // so the user still sees where they are.
            <QuestionnaireComposer
              toolInput={thread.pendingRequest.input}
              onSubmit={(payload) => {
                const pending = thread.pendingRequest;
                if (pending && pending.kind === "ask_user_question") {
                  onResolveRequest(thread.id, pending, payload);
                }
              }}
              onCancel={() => {
                const pending = thread.pendingRequest;
                if (pending) onCancelRequest(thread.id, pending);
              }}
              footer={
                <div className="flex items-center gap-1 mt-2 px-0.5">
                  <StatusButton tooltip="Coming soon">
                    <Monitor size={14} weight="regular" />
                    <span>Local</span>
                  </StatusButton>
                  {thread.branch && (
                    <StatusButton tooltip="Coming soon" fadeIn>
                      <GitBranch size={14} weight="regular" />
                      <span>{thread.branch}</span>
                    </StatusButton>
                  )}
                  {thread.contextStats && thread.provider !== "codex" && (
                    <TokenProgressIndicator stats={thread.contextStats} />
                  )}
                </div>
              }
            />
          ) : (
            <>
              {thread.pendingRequest?.kind === "tool_approval" && (
                <div className="max-w-[720px] mx-auto mb-2">
                  <ToolApprovalCard
                    toolName={thread.pendingRequest.toolName}
                    toolInput={thread.pendingRequest.toolInput}
                    onApprove={() => {
                      const pending = thread.pendingRequest;
                      if (pending?.kind === "tool_approval") {
                        onApproveTool?.(thread.id, pending, true);
                      }
                    }}
                    onReject={() => {
                      const pending = thread.pendingRequest;
                      if (pending?.kind === "tool_approval") {
                        onApproveTool?.(thread.id, pending, false);
                      }
                    }}
                  />
                </div>
              )}
              {thread.pendingRequest?.kind === "exit_plan_approval" && (
                <div className="max-w-[720px] mx-auto mb-2">
                  <PlanApprovalCard
                    plan={thread.pendingRequest.plan}
                    planFilePath={thread.pendingRequest.planFilePath}
                    onApprove={() => {
                      const pending = thread.pendingRequest;
                      if (pending?.kind === "exit_plan_approval") {
                        onApprovePlan?.(thread.id, pending, true);
                      }
                    }}
                    onReject={() => {
                      const pending = thread.pendingRequest;
                      if (pending?.kind === "exit_plan_approval") {
                        onApprovePlan?.(thread.id, pending, false);
                      }
                    }}
                  />
                </div>
              )}
              <ChatComposer
              composerRef={composerRef}
              textareaRef={textareaRef}
              sendButtonRef={sendButtonRef}
              attachments={attachments}
              removeAttachment={removeAttachment}
              onTextChange={handleTextChange}
              onTextKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                  return;
                }
                if (e.key === "Tab" && e.shiftKey) {
                  e.preventDefault();
                  const idx = MODES.findIndex(
                    (m) => m.id === selectedMode.id,
                  );
                  const next = MODES[(idx + 1) % MODES.length];
                  if (thread && next.id !== selectedMode.id) {
                    onSetMode?.(thread.id, next.id);
                  }
                }
              }}
              onTextPaste={handlePaste}
              isDragOver={isDragOver}
              displayedModel={displayedModel}
              provider={thread.provider}
              isStarted={isStarted}
              providers={providers}
              claudeModels={claudeModels}
              codexModels={codexModels}
              selectedEffort={selectedEffort}
              effortList={effortList}
              showEffortPicker={showEffortPicker}
              selectedMode={selectedMode}
              modelDropdownOpen={modelDropdownOpen}
              effortDropdownOpen={effortDropdownOpen}
              modeDropdownOpen={modeDropdownOpen}
              modelDropdownRef={modelDropdownRef}
              effortDropdownRef={effortDropdownRef}
              modeDropdownRef={modeDropdownRef}
              onToggleModelDropdown={() =>
                !isStarted && setModelDropdownOpen((v) => !v)
              }
              onToggleEffortDropdown={() =>
                !isStarted && setEffortDropdownOpen((v) => !v)
              }
              onToggleModeDropdown={() => setModeDropdownOpen((v) => !v)}
              onSelectModel={(m) => {
                setSelectedModel(m);
                // Snap the effort picker to this model's declared
                // default (Codex surfaces one via
                // `defaultReasoningEffort`; Claude doesn't). Fall back
                // to whatever effort was already active when the model
                // has no default or the default isn't in the provider's
                // known effort list.
                const base =
                  m.provider === "codex" ? CODEX_EFFORT : CLAUDE_EFFORT;
                const currentEffort =
                  m.provider === "codex" ? codexEffort : claudeEffort;
                const nextEffort =
                  (m.defaultEffort &&
                    base.find((e) => e.id === m.defaultEffort)) ||
                  currentEffort;
                if (m.provider === "codex") setCodexEffort(nextEffort);
                else setClaudeEffort(nextEffort);
                const selectionToSave = {
                  provider: m.provider,
                  modelId: m.id,
                  effortId: nextEffort.id,
                };
                localStorage.setItem(
                  "lastSelection",
                  JSON.stringify(selectionToSave),
                );
                if (m.provider !== thread.provider) {
                  onUpdateThreadProvider?.(thread.id, m.provider);
                }
                setModelDropdownOpen(false);
              }}
              onSelectEffort={(e) => {
                setSelectedEffort(e);
                if (displayedModel) {
                  const selectionToSave = {
                    provider: displayedModel.provider,
                    modelId: displayedModel.id,
                    effortId: e.id,
                  };
                  localStorage.setItem(
                    "lastSelection",
                    JSON.stringify(selectionToSave),
                  );
                }
                setEffortDropdownOpen(false);
              }}
              onSelectMode={(m) => {
                if (thread && m.id !== selectedMode.id) {
                  onSetMode?.(thread.id, m.id);
                }
                setModeDropdownOpen(false);
              }}
              isRunning={thread.status === "running"}
              onInterrupt={() => onInterrupt(thread.id)}
              onSubmit={handleSubmit}
              placeholder={
                thread.pendingRequest?.kind === "tool_approval"
                  ? "Reply to deny with feedback…"
                  : thread.pendingRequest?.kind === "exit_plan_approval"
                    ? "Reply to dismiss with feedback…"
                    : undefined
              }
              footer={
                <div className="flex items-center gap-1 mt-2 px-0.5">
                  <StatusButton tooltip="Coming soon">
                    <Monitor size={14} weight="regular" />
                    <span>Local</span>
                  </StatusButton>
                  {thread.branch && (
                    <StatusButton tooltip="Coming soon" fadeIn>
                      <GitBranch size={14} weight="regular" />
                      <span>{thread.branch}</span>
                    </StatusButton>
                  )}
                  {thread.contextStats && thread.provider !== "codex" && (
                    <TokenProgressIndicator stats={thread.contextStats} />
                  )}
                </div>
              }
            />
            </>
          )}
        </div>

        {/* Image lightbox */}
        {lightboxUrl && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center outline-none"
            style={{ background: "rgba(0, 0, 0, 0.80)" }}
            onClick={() => setLightboxUrl(null)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setLightboxUrl(null);
            }}
            tabIndex={-1}
            ref={(el) => el?.focus()}
          >
            <img
              src={lightboxUrl}
              alt="Preview"
              className="max-w-[90vw] max-h-[90vh] rounded-2xl object-contain"
              style={{ boxShadow: "0 8px 40px rgba(0, 0, 0, 0.5)" }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </div>
    </OpenFileContext.Provider>
  );
}

function StatusButton({
  children,
  tooltip,
  fadeIn,
}: {
  children: React.ReactNode;
  tooltip?: string;
  fadeIn?: boolean;
}) {
  return (
    <div
      className="relative group/status"
      style={fadeIn ? { animation: "fadeIn 200ms ease" } : undefined}
    >
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
      {tooltip && (
        <div
          className="absolute bottom-full left-0 mb-1.5 px-2.5 py-1.5 rounded-lg text-[12px] whitespace-nowrap opacity-0 group-hover/status:opacity-100 transition-opacity duration-150 pointer-events-none z-50"
          style={{
            background: "var(--surface-2)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border-emphasis)",
          }}
        >
          {tooltip}
        </div>
      )}
    </div>
  );
}

/**
 * Composer variant shown while the agent is paused on an AskUserQuestion.
 * Mirrors ChatComposer's outer chrome (same rounded surface, same
 * max-width, same footer slot) so the swap feels like a mode change on
 * the same input, not a new element. No textarea, no model picker —
 * those would only confuse the user when the turn is waiting on
 * structured answers.
 */
function QuestionnaireComposer({
  toolInput,
  onSubmit,
  onCancel,
  footer,
}: {
  toolInput: Record<string, unknown> | undefined;
  onSubmit: (payload: {
    answers: Record<string, string>;
    displayText: string;
    questionAnswers: Array<{ question: string; value: string }>;
  }) => void;
  onCancel: () => void;
  footer?: React.ReactNode;
}) {
  return (
    <div className="max-w-[720px] mx-auto">
      <div
        className="rounded-2xl relative overflow-hidden"
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--border-default)",
        }}
      >
        <QuestionnaireForm
          toolInput={toolInput}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      </div>
      {footer && <div className="pt-2 px-1">{footer}</div>}
    </div>
  );
}

function ChatComposer({
  composerRef,
  textareaRef,
  sendButtonRef,
  attachments,
  removeAttachment,
  onTextChange,
  onTextKeyDown,
  onTextPaste,
  isDragOver,
  displayedModel,
  provider,
  isStarted,
  providers,
  claudeModels,
  codexModels,
  selectedEffort,
  effortList,
  showEffortPicker,
  selectedMode,
  modelDropdownOpen,
  effortDropdownOpen,
  modeDropdownOpen,
  modelDropdownRef,
  effortDropdownRef,
  modeDropdownRef,
  onToggleModelDropdown,
  onToggleEffortDropdown,
  onToggleModeDropdown,
  onSelectModel,
  onSelectEffort,
  onSelectMode,
  isRunning,
  onInterrupt,
  onSubmit,
  disabled,
  placeholder,
  containerStyle,
  footer,
  animateModelLabel,
  actionButton,
  onActivate,
}: {
  composerRef?: React.RefObject<HTMLDivElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  sendButtonRef?: React.RefObject<SendButtonHandle | null>;
  attachments: ImageAttachment[];
  removeAttachment: (id: string) => void;
  onTextChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  onTextKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
  onTextPaste?: React.ClipboardEventHandler<HTMLTextAreaElement>;
  isDragOver?: boolean;
  displayedModel: ModelDef | null;
  provider: Provider;
  isStarted: boolean;
  providers: { claude: boolean; codex: boolean } | null;
  claudeModels: ModelDef[];
  codexModels: ModelDef[];
  selectedEffort: EffortDef;
  effortList: EffortDef[];
  showEffortPicker: boolean;
  selectedMode: ModeDef;
  modelDropdownOpen: boolean;
  effortDropdownOpen: boolean;
  modeDropdownOpen: boolean;
  modelDropdownRef?: React.RefObject<HTMLDivElement | null>;
  effortDropdownRef?: React.RefObject<HTMLDivElement | null>;
  modeDropdownRef?: React.RefObject<HTMLDivElement | null>;
  onToggleModelDropdown: () => void;
  onToggleEffortDropdown: () => void;
  onToggleModeDropdown: () => void;
  onSelectModel: (model: ModelDef) => void;
  onSelectEffort: (effort: EffortDef) => void;
  onSelectMode: (mode: ModeDef) => void;
  isRunning?: boolean;
  onInterrupt?: () => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  containerStyle?: React.CSSProperties;
  footer?: React.ReactNode;
  animateModelLabel?: boolean;
  actionButton?: React.ReactNode;
  onActivate?: () => void;
}) {
  const modelLabelRef = useRef<HTMLSpanElement>(null);
  const [modelLabelWidth, setModelLabelWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!animateModelLabel || !modelLabelRef.current) return;
    setModelLabelWidth(modelLabelRef.current.offsetWidth);
  }, [
    animateModelLabel,
    displayedModel?.id,
    displayedModel?.badge,
    displayedModel?.label,
  ]);

  return (
    <div className="max-w-[720px] mx-auto">
      <div
        ref={composerRef}
        className="rounded-2xl relative"
        style={{
          background: "var(--surface-2)",
          border: isDragOver
            ? "1px solid var(--border-emphasis)"
            : "1px solid var(--border-default)",
          transition: "border-color 150ms ease",
          cursor:
            disabled && onActivate
              ? "pointer"
              : disabled
                ? "default"
                : undefined,
          ...containerStyle,
        }}
      >
        {actionButton && (
          <div className="absolute right-3 top-3 z-[2]">{actionButton}</div>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3 pb-1">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-1.5 pl-1 pr-1 py-0.5 rounded-lg group/chip"
                style={{
                  background: "var(--surface-3)",
                  border: "1px solid var(--border-default)",
                }}
              >
                <img
                  src={a.previewUrl}
                  alt={a.name}
                  className="w-5 h-5 rounded object-cover"
                />
                <span
                  className="text-[12px] font-medium max-w-[140px] truncate"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {a.name}
                </span>
                <button
                  onClick={() => removeAttachment(a.id)}
                  disabled={disabled}
                  className="w-4 h-4 flex items-center justify-center rounded transition-colors"
                  style={{ color: "var(--text-faint)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "var(--text-primary)";
                    e.currentTarget.style.background = "var(--surface-4)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--text-faint)";
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <X size={10} weight="bold" />
                </button>
              </div>
            ))}
          </div>
        )}
        <TextareaWithScrollbar
          textareaRef={textareaRef}
          onChange={onTextChange}
          onKeyDown={onTextKeyDown}
          onPaste={onTextPaste}
          disabled={disabled}
          placeholder={placeholder}
          onClick={disabled ? () => onActivate?.() : undefined}
        />
        <div className="flex items-center justify-between px-2 pb-2">
          <div className="flex items-center gap-0">
            <div className="relative" ref={modelDropdownRef}>
              <ControlButton
                onClick={onToggleModelDropdown}
                disabled={disabled || isStarted}
                tooltip={
                  !disabled && isStarted
                    ? "Can't change model after thread has started"
                    : undefined
                }
              >
                {provider === "claude" ? (
                  <ClaudeIcon className="w-[14px] h-[14px] shrink-0 text-[#D97757]" />
                ) : (
                  <OpenAIIcon className="w-[13px] h-[13px] shrink-0 text-white/90" />
                )}
                <span
                  className="inline-flex overflow-hidden"
                  style={
                    animateModelLabel
                      ? {
                          width: modelLabelWidth ?? undefined,
                          transition: "width 260ms ease",
                        }
                      : undefined
                  }
                >
                  <span
                    ref={modelLabelRef}
                    key={displayedModel?.id ?? provider}
                    className="inline-flex whitespace-nowrap"
                    style={
                      animateModelLabel
                        ? { animation: "fadeIn 260ms ease" }
                        : undefined
                    }
                  >
                    {displayedModel?.label ?? "Loading models…"}
                    {displayedModel?.badge && (
                      <span
                        className="ml-1"
                        style={{ color: "var(--text-faint)" }}
                      >
                        {displayedModel.badge}
                      </span>
                    )}
                  </span>
                </span>
                <CaretDown size={10} weight="bold" />
              </ControlButton>
              {!disabled &&
                modelDropdownOpen &&
                !isStarted &&
                displayedModel && (
                  <ModelDropdown
                    sections={[
                      {
                        label: "Anthropic",
                        models: claudeModels,
                        available: providers?.claude !== false,
                        installUrl:
                          "https://code.claude.com/docs/en/quickstart#before-you-begin",
                      },
                      {
                        label: "OpenAI",
                        models: codexModels,
                        available: providers?.codex !== false,
                        installUrl:
                          "https://developers.openai.com/codex/quickstart?setup=cli",
                      },
                    ]}
                    selected={displayedModel}
                    onSelect={onSelectModel}
                  />
                )}
            </div>
            {showEffortPicker && (
              <div className="relative" ref={effortDropdownRef}>
                <ControlButton
                  onClick={onToggleEffortDropdown}
                  disabled={disabled || isStarted}
                  tooltip={
                    !disabled && isStarted
                      ? "Can't change effort after thread has started"
                      : undefined
                  }
                >
                  <span>{selectedEffort.label}</span>
                  <CaretDown size={10} weight="bold" />
                </ControlButton>
                {!disabled && effortDropdownOpen && (
                  <EffortDropdown
                    levels={effortList}
                    selected={selectedEffort}
                    onSelect={onSelectEffort}
                  />
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="relative" ref={modeDropdownRef}>
              <ControlButton onClick={onToggleModeDropdown} disabled={disabled}>
                <span>{selectedMode.label}</span>
                <CaretDown size={10} weight="bold" />
              </ControlButton>
              {!disabled && modeDropdownOpen && (
                <ModeDropdown
                  modes={MODES}
                  selected={selectedMode}
                  onSelect={onSelectMode}
                />
              )}
            </div>
            {!disabled && isRunning ? (
              <button
                onClick={onInterrupt}
                className="w-[30px] h-[30px] flex items-center justify-center rounded-full transition-all"
                style={{
                  background: "var(--text-primary)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.85)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--text-primary)";
                }}
              >
                <Stop
                  size={14}
                  weight="fill"
                  style={{ color: "var(--surface-0)" }}
                />
              </button>
            ) : (
              <SendButton
                ref={sendButtonRef}
                hasAttachments={attachments.length > 0}
                onClick={onSubmit}
                disabled={disabled}
              />
            )}
          </div>
        </div>
      </div>
      {footer && <div className="pt-2 px-1">{footer}</div>}
    </div>
  );
}

/** Prominent install-CLI button shown in place of the composer when
 *  no agent CLI is installed. Larger than `ControlButton` — this is the
 *  primary (and only) affordance at the bottom of the chat, so it
 *  should read as a real CTA, not as composer chrome. */
function InstallPromptButton({
  provider,
  label,
  url,
}: {
  provider: Provider;
  label: string;
  url: string;
}) {
  return (
    <button
      type="button"
      onClick={() => window.openclawdex.openExternal(url)}
      onMouseDown={(e) => e.preventDefault()}
      className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-colors"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border-default)",
        color: "var(--text-primary)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--surface-3)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--surface-2)";
      }}
    >
      {provider === "claude" ? (
        <ClaudeIcon className="w-[15px] h-[15px] shrink-0 text-[#D97757]" />
      ) : (
        <OpenAIIcon className="w-[14px] h-[14px] shrink-0 text-white/90" />
      )}
      <span>{label}</span>
      <ArrowSquareOut
        size={12}
        weight="regular"
        style={{ color: "var(--text-muted)" }}
      />
    </button>
  );
}

function ControlButton({
  children,
  onClick,
  tooltip,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tooltip?: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative group/ctrl">
      <button
        onClick={onClick}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        className="flex items-center gap-1.5 px-2 py-[5px] rounded-xl text-[13px] font-medium transition-colors hover:bg-[var(--border-subtle)] hover:text-[rgba(255,255,255,0.60)]"
        style={{
          color: "var(--text-muted)",
          cursor: disabled ? "default" : "pointer",
        }}
      >
        {children}
      </button>
      {tooltip && (
        <div
          className="absolute bottom-full left-0 mb-1.5 px-2.5 py-1.5 rounded-lg text-[12px] whitespace-nowrap opacity-0 group-hover/ctrl:opacity-100 transition-opacity duration-150 pointer-events-none z-50"
          style={{
            background: "var(--surface-2)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border-emphasis)",
          }}
        >
          {tooltip}
        </div>
      )}
    </div>
  );
}

/* ── Open-in-editor dropdown ────────────────────────────────── */

function OpenInEditorDropdown({
  top,
  right,
  onSelect,
}: {
  top: number;
  right: number;
  onSelect: (editor: EditorTarget) => void;
}) {
  type Item = { id: EditorTarget; label: string; icon: React.ReactNode };
  const groups: Item[][] = [
    [
      { id: "vscode", label: "VSCode", icon: <VSCodeIcon size={14} /> },
      {
        id: "cursor",
        label: "Cursor",
        icon: (
          <span style={{ color: "var(--text-primary)" }}>
            <CursorIcon size={14} />
          </span>
        ),
      },
    ],
    [
      { id: "terminal", label: "Terminal", icon: <TerminalIcon size={14} /> },
      { id: "iterm", label: "iTerm2", icon: <ITermIcon size={14} /> },
      { id: "ghostty", label: "Ghostty", icon: <GhosttyIcon size={14} /> },
    ],
    [{ id: "finder", label: "Finder", icon: <FinderIcon size={14} /> }],
  ];
  return (
    <DropdownSurface
      variant="floating"
      className="fixed z-[70]"
      style={{ top, right, minWidth: "160px" }}
      onClick={(e) => e.stopPropagation()}
    >
      {groups.map((group, gi) => (
        <div key={gi} className="flex flex-col gap-[2px]">
          {gi > 0 && <DropdownDivider variant="floating" />}
          {group.map((it) => (
            <DropdownItem
              key={it.id}
              variant="floating"
              onClick={() => onSelect(it.id)}
            >
              <span className="flex items-center justify-center w-[16px] h-[16px] shrink-0">
                {it.icon}
              </span>
              {it.label}
            </DropdownItem>
          ))}
        </div>
      ))}
    </DropdownSurface>
  );
}

/* ── Project-name dropdown (empty-hero) ─────────────────────── */

/**
 * Inline project-switcher rendered in place of the highlighted
 * `{projectName}` inside the empty-thread hero ("What are we building
 * in <projectName>?"). Lets the user pick a different project for the
 * current thread, or create a new one. Font sizing is reset inside the
 * menu because the hero's parent is 28px — dropdown items use the
 * regular 13px UI scale.
 */
function ProjectNameDropdown({
  projectName,
  projects,
  currentProjectId,
  onSelect,
  onCreateNew,
}: {
  projectName: string;
  projects: ProjectInfo[];
  currentProjectId: string | null;
  onSelect: (projectId: string) => void;
  onCreateNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 mx-0.5 px-1.5 py-0.5 rounded-xl transition-colors"
        style={{
          color: "rgba(255,255,255,0.95)",
          background: open ? "rgba(255,255,255,0.08)" : "transparent",
        }}
        onMouseEnter={(e) => {
          if (!open)
            e.currentTarget.style.background = "rgba(255,255,255,0.06)";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = "transparent";
        }}
      >
        <span>{projectName}</span>
        <CaretDown size={14} weight="bold" style={{ opacity: 0.4 }} />
      </button>
      {open && (
        <DropdownSurface
          variant="composer"
          className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50"
          style={{
            minWidth: "240px",
            // Reset typography — hero parent is 28px/tracking-tight/font-medium.
            // Item weight is governed by DropdownItem (font-medium); this just
            // neutralizes the inherited size/letter-spacing for any non-item
            // content inside the menu.
            fontSize: "13px",
            letterSpacing: "normal",
            color: "var(--text-primary)",
          }}
          onMouseDownCapture={(e) => e.stopPropagation()}
        >
          {projects.map((p) => {
            const isSelected = p.id === currentProjectId;
            return (
              <DropdownItem
                key={p.id}
                variant="composer"
                selected={isSelected}
                onClick={() => {
                  setOpen(false);
                  onSelect(p.id);
                }}
              >
                <Folder
                  size={14}
                  weight="light"
                  style={{ color: "var(--text-muted)", flexShrink: 0 }}
                />
                <span className="flex-1 truncate">{p.name}</span>
                {isSelected && (
                  <Check
                    size={13}
                    weight="bold"
                    style={{ color: "var(--text-primary)", flexShrink: 0 }}
                  />
                )}
              </DropdownItem>
            );
          })}
          {projects.length > 0 && <DropdownDivider variant="composer" />}
          <DropdownItem
            variant="composer"
            onClick={() => {
              setOpen(false);
              onCreateNew();
            }}
            style={{ color: "var(--text-secondary)" }}
          >
            <Plus size={14} weight="light" style={{ flexShrink: 0 }} />
            <span>Add a project…</span>
          </DropdownItem>
        </DropdownSurface>
      )}
    </span>
  );
}

/* ── Model dropdown ─────────────────────────────────────────── */

interface ModelSection {
  label: string;
  models: ModelDef[];
  /**
   * Whether the backing CLI for this provider is installed on $PATH.
   * Defaults to `true` when omitted so existing call sites that don't
   * know about availability keep working. When `false`, the section
   * renders an install CTA row in place of the (necessarily empty)
   * model list.
   */
  available?: boolean;
  /** URL to the provider's official install / setup page. */
  installUrl?: string;
}

/** Single row shown in place of a provider's model list when its CLI
 *  isn't installed. Clicking opens the provider's install docs in the
 *  user's default browser via `shell.openExternal` (main side gates
 *  to http(s) only). */
function InstallCtaRow({
  provider,
  installUrl,
}: {
  provider: Provider;
  installUrl: string;
}) {
  const productName = provider === "claude" ? "Claude Code" : "Codex CLI";
  const displayHost = (() => {
    try {
      return new URL(installUrl).host;
    } catch {
      return installUrl;
    }
  })();
  const handleOpen = () => {
    if (!installUrl) return;
    window.openclawdex.openExternal(installUrl);
  };
  return (
    <DropdownItem variant="composer" align="start" onClick={handleOpen}>
      {provider === "claude" ? (
        <ClaudeIcon className="w-[20px] h-[20px] shrink-0 mt-0.5 text-[#D97757] opacity-60" />
      ) : (
        <OpenAIIcon className="w-[18px] h-[18px] shrink-0 mt-0.5 text-white/90 opacity-60" />
      )}
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <span className="leading-tight">Install {productName}</span>
        <span
          className="text-[11px] leading-tight truncate"
          style={{ color: "var(--text-muted)" }}
        >
          {displayHost}
        </span>
      </div>
      <ArrowSquareOut
        size={14}
        weight="regular"
        className="shrink-0 self-center"
        style={{ color: "var(--text-muted)" }}
      />
    </DropdownItem>
  );
}

function ModelDropdown({
  sections,
  selected,
  onSelect,
}: {
  sections: ModelSection[];
  selected: ModelDef;
  onSelect: (m: ModelDef) => void;
}) {
  return (
    <DropdownSurface
      variant="composer"
      className="absolute bottom-full left-0 mb-2 w-[300px] z-50"
      onMouseDownCapture={(e) => e.preventDefault()}
    >
      {sections.map((section, sIdx) => {
        const available = section.available !== false;
        const providerKey: Provider =
          section.label === "Anthropic" ? "claude" : "codex";
        return (
          <div key={section.label} className="flex flex-col gap-[2px]">
            {sIdx > 0 && <DropdownDivider variant="composer" />}
            <DropdownSectionHeader>{section.label}</DropdownSectionHeader>
            {!available ? (
              // CLI isn't on $PATH → the models array is empty anyway
              // (listClaudeModels/listCodexModels return [] when the CLI
              // is missing). Render a single install CTA row instead of
              // a bare, headers-only section. Clicking copies the install
              // command to the clipboard — lightest-weight "click to fix"
              // we can offer without shelling out to a terminal.
              <InstallCtaRow
                provider={providerKey}
                installUrl={section.installUrl ?? ""}
              />
            ) : (
              section.models.map((m) => {
                const isSelected = m.id === selected.id;
                return (
                  <DropdownItem
                    key={m.id}
                    variant="composer"
                    selected={isSelected}
                    align="start"
                    onClick={() => onSelect(m)}
                  >
                    {m.provider === "claude" ? (
                      <ClaudeIcon className="w-[20px] h-[20px] shrink-0 mt-0.5 text-[#D97757]" />
                    ) : (
                      <OpenAIIcon className="w-[18px] h-[18px] shrink-0 mt-0.5 text-white/90" />
                    )}
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <span className="leading-tight">
                        {m.provider === "claude"
                          ? `Claude ${m.label}`
                          : m.label}
                        {m.badge && (
                          <span
                            className="ml-1.5 text-[11px]"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {m.badge}
                          </span>
                        )}
                      </span>
                      <span
                        className="text-[11px] leading-tight truncate"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {m.subtitle}
                      </span>
                    </div>
                    {isSelected && (
                      <Check
                        size={14}
                        weight="bold"
                        className="shrink-0 self-center"
                        style={{ color: "var(--text-primary)" }}
                      />
                    )}
                  </DropdownItem>
                );
              })
            )}
          </div>
        );
      })}
    </DropdownSurface>
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
    <DropdownSurface
      variant="composer"
      className="absolute bottom-full left-0 mb-2 min-w-[280px] z-50"
      onMouseDownCapture={(e) => e.preventDefault()}
    >
      {levels.map((lvl) => {
        const isSelected = lvl.id === selected.id;
        return (
          <DropdownItem
            key={lvl.id}
            variant="composer"
            selected={isSelected}
            onClick={() => onSelect(lvl)}
          >
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <span className="leading-tight">{lvl.label}</span>
              <span
                className="text-[11px] leading-tight"
                style={{ color: "var(--text-muted)" }}
              >
                {lvl.subtitle}
              </span>
            </div>
            {isSelected && (
              <Check
                size={14}
                weight="bold"
                className="shrink-0"
                style={{ color: "var(--text-primary)" }}
              />
            )}
          </DropdownItem>
        );
      })}
    </DropdownSurface>
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
    <DropdownSurface
      variant="composer"
      className="absolute bottom-full right-0 mb-2 min-w-[300px] z-50"
      onMouseDownCapture={(e) => e.preventDefault()}
    >
      {modes.map((mode) => {
        const isSelected = mode.id === selected.id;
        return (
          <DropdownItem
            key={mode.id}
            variant="composer"
            selected={isSelected}
            onClick={() => onSelect(mode)}
          >
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <span className="leading-tight">{mode.label}</span>
              <span
                className="text-[11px] leading-tight"
                style={{ color: "var(--text-muted)" }}
              >
                {mode.subtitle}
              </span>
            </div>
            {isSelected && (
              <Check
                size={14}
                weight="bold"
                className="shrink-0"
                style={{ color: "var(--text-primary)" }}
              />
            )}
          </DropdownItem>
        );
      })}
    </DropdownSurface>
  );
}
