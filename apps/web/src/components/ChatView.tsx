import { useState, useRef, useEffect, useLayoutEffect, useCallback, createContext, useContext } from "react";
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
} from "@phosphor-icons/react";
import { QuestionCard } from "./QuestionCard";
import type { Thread, Message, FileChange, ContextStats } from "../App";
import { EditorTarget } from "@openclawdex/shared";

/* ── Editor logos ────────────────────────────────────────────── */

function VSCodeIcon({ size = 14 }: { size?: number }) {
  // simple-icons VSCode glyph (stylized blue ribbon)
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="#3DA0E2" aria-hidden>
      <path d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448z" />
    </svg>
  );
}

function CursorIcon({ size = 14 }: { size?: number }) {
  // Official Cursor light logo (outlined hex)
  return (
    <svg viewBox="0 0 466.73 532.09" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z" />
    </svg>
  );
}

function FinderIcon({ size = 14 }: { size?: number }) {
  return <img src={finderIconUrl} width={size} height={size} alt="" aria-hidden draggable={false} />;
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
        <linearGradient id="iterm-grad" x1="512" y1="100" x2="512" y2="924" gradientUnits="userSpaceOnUse">
          <stop stopColor="#D4E6E8" />
          <stop offset="1" stopColor="#767573" />
        </linearGradient>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="179" fill="url(#iterm-grad)" />
      <rect x="121.788" y="121.789" width="780.423" height="780.423" rx="156" fill="black" />
      <rect x="183.192" y="183.192" width="657.615" height="657.615" rx="94" fill="#202A2F" />
      <rect x="367.404" y="226.769" width="89.1346" height="178.269" fill="#0EE827" fillOpacity="0.35" />
      <path fill="#0EE827" d="M274.468 374.622C269.807 374.227 265.438 373.568 261.36 372.645C257.427 371.59 253.786 370.47 250.436 369.284C247.232 368.097 244.392 366.977 241.916 365.922C239.586 364.736 237.838 363.813 236.673 363.154L246.067 345.754C247.086 346.413 248.834 347.335 251.31 348.522C253.786 349.708 256.553 350.96 259.612 352.279C262.816 353.465 266.093 354.52 269.443 355.442C272.793 356.365 275.924 356.827 278.837 356.827C293.402 356.827 300.684 351.356 300.684 340.415C300.684 337.778 300.174 335.603 299.154 333.89C298.281 332.176 296.897 330.726 295.004 329.54C293.256 328.221 291.071 327.101 288.45 326.178C285.974 325.124 283.134 324.069 279.929 323.015C273.812 320.905 268.351 318.73 263.544 316.489C258.884 314.117 254.878 311.48 251.529 308.58C248.179 305.68 245.63 302.385 243.882 298.694C242.135 295.003 241.261 290.784 241.261 286.039C241.261 282.348 242.062 278.789 243.664 275.361C245.266 271.934 247.523 268.902 250.436 266.266C253.349 263.498 256.845 261.191 260.923 259.345C265.001 257.368 269.516 255.984 274.468 255.193V226.769H292.382V254.797C296.169 255.193 299.81 255.786 303.305 256.577C306.801 257.368 309.932 258.225 312.699 259.147C315.467 260.07 317.797 260.993 319.69 261.916C321.729 262.707 323.186 263.3 324.06 263.695L315.321 279.909C314.156 279.382 312.481 278.723 310.296 277.932C308.257 277.009 305.927 276.086 303.305 275.164C300.684 274.241 297.844 273.45 294.785 272.791C291.727 272.132 288.668 271.802 285.61 271.802C280.658 271.802 276.215 272.725 272.283 274.57C268.496 276.284 266.603 279.25 266.603 283.468C266.603 286.105 267.113 288.478 268.132 290.587C269.297 292.564 270.899 294.344 272.938 295.925C275.123 297.507 277.745 299.023 280.803 300.473C284.007 301.791 287.649 303.11 291.727 304.428C297.115 306.405 301.922 308.448 306.145 310.558C310.369 312.667 313.937 315.039 316.85 317.676C319.763 320.312 321.948 323.344 323.404 326.771C325.006 330.199 325.807 334.219 325.807 338.833C325.807 342.788 325.079 346.61 323.623 350.301C322.312 353.992 320.2 357.42 317.287 360.583C314.52 363.747 311.025 366.515 306.801 368.888C302.723 371.129 297.916 372.777 292.382 373.831V403.058H274.468V374.622Z" />
    </svg>
  );
}

/* ── Editor target helpers ───────────────────────────────────── */

function isEditorTarget(v: string): v is EditorTarget {
  return EditorTarget.safeParse(v).success;
}

function editorLabel(t: EditorTarget): string {
  switch (t) {
    case "vscode": return "VSCode";
    case "cursor": return "Cursor";
    case "finder": return "Finder";
    case "terminal": return "Terminal";
    case "iterm": return "iTerm2";
    case "ghostty": return "Ghostty";
  }
}

function EditorTargetIcon({ target, size = 16 }: { target: EditorTarget; size?: number }) {
  switch (target) {
    case "vscode": return <VSCodeIcon size={size} />;
    case "cursor": return <span style={{ color: "var(--text-primary)", display: "inline-flex" }}><CursorIcon size={size} /></span>;
    case "finder": return <FinderIcon size={size} />;
    case "terminal": return <TerminalIcon size={size} />;
    case "iterm": return <ITermIcon size={size} />;
    case "ghostty": return <GhosttyIcon size={size} />;
  }
}

/* ── Open-in-editor context ─────────────────────────────────── */

/** Provides an "open file in the user's preferred editor" handler to nested content. */
interface OpenFileCtx {
  open: (path: string, line?: number) => void;
  editorLabel: string;
}
const OpenFileContext = createContext<OpenFileCtx | null>(null);

/**
 * Parse a file reference like `path/to/file.tsx`, `file.tsx:42`, or
 * `file.tsx (line 42)` / `file.tsx (lines 42-50)` into path + optional line.
 * Also handles lists/ranges after the first line number, e.g.
 * `file.tsx:85, 116, 128` or `file.tsx:190–191` — the first number wins.
 */
function parseFileRef(text: string): { path: string; line?: number } | null {
  const trimmed = text.trim();
  // "file (line 42)" or "file (lines 42-50)"
  const parenMatch = trimmed.match(/^(.+?)\s*\(lines?\s+(\d+)(?:-\d+)?\)$/i);
  if (parenMatch) return { path: parenMatch[1], line: Number(parenMatch[2]) };
  // "file:42", "file:42:5", "file:42, 50, 60", "file:190–191", etc.
  // Accept any non-digit trailer after the first line number so comma lists
  // and en/em-dash ranges don't poison the path.
  const colonMatch = trimmed.match(/^(.+?):(\d+)(?:\D.*)?$/);
  if (colonMatch && colonMatch[1].includes("/")) {
    return { path: colonMatch[1], line: Number(colonMatch[2]) };
  }
  if (trimmed.includes("/")) return { path: trimmed };
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
}

/* ── Claude sparkle icon ────────────────────────────────────── */

function ClaudeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 248 248" fill="currentColor" className={className}>
      <path d="M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z" />
    </svg>
  );
}

/* ── OpenAI blossom icon ────────────────────────────────────── */

function OpenAIIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
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
                const ctxMatch = rawHead.match(/^(.*?)\s+with\s+(\S+)\s+context\s*$/i);
                const label = ctxMatch ? ctxMatch[1].trim() : rawHead;
                const badge = ctxMatch ? ctxMatch[2] : undefined;
                const subtitle = rest
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0 && !/\bbilled\b/i.test(s) && !/\$/.test(s))
                  .join(" · ");
                // `supportsEffort: false` or a missing
                // `supportedEffortLevels` array (e.g. Haiku) means the
                // model has no reasoning knob — represent that as an
                // empty list so the effort picker hides.
                const supportedEfforts = m.supportsEffort && m.supportedEffortLevels
                  ? m.supportedEffortLevels
                  : [];
                return {
                  id: m.value,
                  label,
                  subtitle: subtitle || m.displayName,
                  provider: "claude" as const,
                  badge,
                  supportedEfforts,
                };
              })
            : [];
        claudeModelsCache = result;
        return result;
      })
      .catch(() => [] as ModelDef[]);
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
function codexSubtitle(model: {
  model: string;
  isDefault: boolean;
}): string {
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
          supportedEfforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort),
        }));
        codexModelsCache = result;
        return result;
      })
      .catch(() => [] as ModelDef[]);
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
  { id: "minimal", label: "Minimal", subtitle: "Fastest, barely any reasoning" },
];

/* ── Modes ──────────────────────────────────────────────────── */

interface ModeDef {
  id: string;
  label: string;
  subtitle: string;
  comingSoon?: boolean;
}

const MODES: ModeDef[] = [
  { id: "plan", label: "Plan mode", subtitle: "Outline a plan without making changes", comingSoon: true },
  { id: "ask", label: "Ask before edits", subtitle: "Confirm each file change before applying", comingSoon: true },
  { id: "auto", label: "Auto-accept edits", subtitle: "Apply changes without asking" },
];

/* ── File change card ────────────────────────────────────────── */

function FileChangeCard({ changes, onOpenFile }: { changes: FileChange[]; onOpenFile?: (path: string) => void }) {
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
        <button
          key={i}
          onClick={() => onOpenFile?.(fc.path)}
          className="w-full flex items-center gap-2 px-3 py-[7px] transition-colors text-left"
          style={{ cursor: onOpenFile ? "pointer" : "default" }}
          title={onOpenFile ? `Open in ${ctx?.editorLabel ?? "editor"}` : undefined}
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
      // Codex file_change: {changes: [{path, kind}], status}
      const changes = Array.isArray(input.changes) ? input.changes : [];
      if (changes.length === 0) return "apply_patch";
      const first = changes[0] as { path?: string; kind?: string };
      const base = first?.path ? first.path.split("/").at(-1) : null;
      const more = changes.length > 1 ? ` +${changes.length - 1}` : "";
      return base ? `${first.kind ?? "edit"} ${base}${more}` : "apply_patch";
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
function toolFilePath(toolName: string, toolInput?: Record<string, unknown>): string | null {
  if (!toolInput) return null;
  if (toolName === "Read" || toolName === "Edit" || toolName === "Write") {
    const fp = toolInput.file_path;
    return typeof fp === "string" && fp.length > 0 ? fp : null;
  }
  if (toolName === "apply_patch") {
    // Codex file_change: return the first changed file's path
    const changes = Array.isArray(toolInput.changes) ? toolInput.changes : [];
    const first = changes[0] as { path?: string } | undefined;
    return typeof first?.path === "string" && first.path.length > 0 ? first.path : null;
  }
  return null;
}

function ToolUseIndicator({ toolName, toolInput, onOpenFile }: { toolName: string; toolInput?: Record<string, unknown>; onOpenFile?: (path: string) => void }) {
  const ctx = useContext(OpenFileContext);
  const summary = toolSummary(toolName, toolInput);
  const maxLen = 120;
  const display = summary.length > maxLen ? summary.slice(0, maxLen) + "…" : summary;
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
        fontFamily: 'var(--font-code)',
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
  const hasContext = stats.percentage != null && stats.totalTokens != null && stats.maxTokens != null;
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
          <circle cx="7" cy="7" r={r} stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.5" />
          {hasContext && (
            <circle
              cx="7" cy="7" r={r}
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
        <div className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
          Context window
        </div>
        {hasContext && pct != null ? (
          <>
            <div className="mb-0.5">{pct}% used ({100 - pct}% left)</div>
            <div>{fmt(stats.totalTokens!)} / {fmt(stats.maxTokens!)} tokens</div>
          </>
        ) : (
          <div style={{ color: "var(--text-muted)" }}>Usage unavailable</div>
        )}
      </div>
    </div>
  );
}

function MessageBlock({ message, isStreaming, showHoverBar, onImageClick, onOpenFile }: { message: Message; isStreaming: boolean; showHoverBar: boolean; onImageClick?: (url: string) => void; onOpenFile?: (path: string) => void }) {
  if (message.collapsed) {
    return <CollapsedIndicator count={message.collapsed} />;
  }

  if (message.role === "tool_use") {
    return <ToolUseIndicator toolName={message.toolName ?? "unknown"} toolInput={message.toolInput} onOpenFile={onOpenFile} />;
  }

  const isUser = message.role === "user";

  if (isUser) {
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
            className="rounded-2xl px-5 py-3.5 text-[14px] leading-[1.6] font-medium break-words"
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
    fontFamily: 'var(--font-mono)',
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

function CodeBlock({ language, children }: { language: string | undefined; children: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [children]);

  const label = language ? LANG_LABELS[language] ?? language : null;

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
          style={{ color: copied ? "#2EB67D" : "rgba(255,255,255,0.35)", lineHeight: 1 }}
          onMouseEnter={(e) => {
            if (!copied) {
              e.currentTarget.style.color = "var(--text-primary)";
              e.currentTarget.style.background = "var(--surface-3)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = copied ? "#2EB67D" : "rgba(255,255,255,0.35)";
            e.currentTarget.style.background = "transparent";
          }}
          title="Copy code"
        >
          {copied ? <Check size={14} weight="bold" /> : <Copy size={14} weight="regular" />}
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
}

function FileRefCode({ inner }: { inner: string }) {
  const ctx = useContext(OpenFileContext);
  const ref = parseFileRef(inner);
  if (!ctx || !ref) {
    return (
      <code className="font-mono text-[12.5px] font-semibold" style={{ color: "#6DC6FF" }}>
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
          const codeString = String(children).replace(/\n$/, "");
          // Block code: has language class OR contains newlines (fenced block without lang)
          const hasLang = className?.includes("language-");
          const isBlock = hasLang || codeString.includes("\n");
          if (isBlock) {
            const language = hasLang ? className?.replace("language-", "") : undefined;
            return <CodeBlock language={language}>{codeString}</CodeBlock>;
          }
          const inner = String(children);
          const isFileRef = inner.includes("/") || inner.includes("(line");
          if (isFileRef) {
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
        table: ({ children }) => (
          <div className="mb-3 last:mb-0 overflow-x-auto rounded-2xl" style={{ border: "2px solid var(--border-subtle)" }}>
            <table className="w-full text-[13px]">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead style={{ background: "rgba(255,255,255,0.06)" }}>{children}</thead>
        ),
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children }) => (
          <tr className="border-b-2 last:border-b-0" style={{ borderColor: "var(--border-subtle)" }}>{children}</tr>
        ),
        th: ({ children }) => (
          <th className="px-3 py-2 text-left font-semibold border-r-2 last:border-r-0" style={{ color: "var(--text-primary)", borderColor: "var(--border-subtle)" }}>{children}</th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-2 border-r-2 last:border-r-0" style={{ color: "var(--text-secondary)", borderColor: "var(--border-subtle)" }}>{children}</td>
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
  onPaste,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
  onPaste?: React.ClipboardEventHandler<HTMLTextAreaElement>;
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
        onPaste={onPaste}
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
  projectCwd?: string;
  onSend: (threadId: string, text: string, images?: ImagePayload[], opts?: { model?: string; effort?: string }) => void;
  onInterrupt: (threadId: string) => void;
  onRespondToTool: (threadId: string, toolUseId: string, text: string) => void;
  /**
   * Flip the pending thread's provider when the user picks a Codex model
   * on a brand-new (uncommitted) conversation. No-op for already-started
   * threads — provider is frozen after session_init.
   */
  onUpdateThreadProvider?: (threadId: string, provider: Provider) => void;
}

export function ChatView({ thread, projectCwd, onSend, onInterrupt, onRespondToTool, onUpdateThreadProvider }: ChatViewProps) {
  const [input, setInput] = useState("");
  // GOTCHA: `selectedModel` is the unified picker state. When the user
  // picks a Codex model on a pending thread, we also call
  // `onUpdateThreadProvider` to flip the thread.provider so subsequent
  // handleSend routes to the Codex backend.
  // `selectedModel` starts null on a fresh mount — the real default
  // is picked once the live list loads (see the effect below that
  // auto-syncs it when claudeModels/codexModels arrive). The last
  // user-picked id is remembered in localStorage and re-applied once
  // the list for its provider loads.
  const [selectedModel, setSelectedModel] = useState<ModelDef | null>(
    claudeModelsCache?.[0] ?? null,
  );
  // Live Claude + Codex model lists, fetched from the respective
  // SDK/CLI on mount. Start from the module-level cache if a previous
  // mount already loaded them; otherwise empty until loadXxx resolves.
  const [claudeModels, setClaudeModels] = useState<ModelDef[]>(claudeModelsCache ?? []);
  const [codexModels, setCodexModels] = useState<ModelDef[]>(codexModelsCache ?? []);
  useEffect(() => {
    loadClaudeModels().then(setClaudeModels);
    loadCodexModels().then(setCodexModels);
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
  const [selectedMode, setSelectedMode] = useState(MODES[2]); // default "Auto-accept edits" (only available mode for now)
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const modeDropdownRef = useRef<HTMLDivElement>(null);
  const [editorDropdownOpen, setEditorDropdownOpen] = useState(false);
  const [editorDropdownPos, setEditorDropdownPos] = useState<{ top: number; right: number } | null>(null);
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
  const currentThreadIdRef = useRef<string | undefined>(undefined);
  const prevHistoryLoadedRef = useRef<boolean | undefined>(undefined);

  // ── Image lightbox ──────────────────────────────────────────
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // ── Image attachments ──────────────────────────────────────
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);
  const composerRef = useRef<HTMLDivElement>(null);

  // Clear attachments when switching threads
  useEffect(() => {
    setAttachments((prev) => {
      prev.forEach((a) => URL.revokeObjectURL(a.previewUrl));
      return [];
    });
  }, [thread?.id]);

  const addFiles = useCallback((files: FileList | File[]) => {
    // GOTCHA: Codex threads don't support images in v1. The SDK wants
    // filesystem paths (local_image) rather than base64, and we'd have
    // to round-trip through the main process to write temp files. For
    // now we silently ignore attachments on Codex threads.
    if (thread?.provider === "codex") return;
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    const newAttachments: ImageAttachment[] = images.map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      previewUrl: URL.createObjectURL(file),
    }));
    setAttachments((prev) => [...prev, ...newAttachments]);
  }, [thread?.provider]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const removed = prev.find((a) => a.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  // Drag handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  // Paste handler for images
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
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
  }, [addFiles]);

  const handleMessagesScroll = useCallback((el: HTMLDivElement) => {
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    isAtBottomRef.current = atBottom;
    setShowScrollBtn(!atBottom);
  }, []);

  // Scroll to bottom: instant on thread switch or history load, smooth for new messages
  useLayoutEffect(() => {
    const threadChanged = thread?.id !== currentThreadIdRef.current;
    const historyJustLoaded = !threadChanged && !!thread?.historyLoaded && !prevHistoryLoadedRef.current;

    currentThreadIdRef.current = thread?.id;
    prevHistoryLoadedRef.current = thread?.historyLoaded;

    if (threadChanged || historyJustLoaded) {
      isAtBottomRef.current = true;
      setShowScrollBtn(false);
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
    } else if (isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [thread?.id, thread?.historyLoaded, thread?.messages]);

  // Autofocus composer when thread changes
  useEffect(() => {
    if (thread?.id) {
      textareaRef.current?.focus();
    }
  }, [thread?.id]);

  const handleSubmit = async () => {
    const hasContent = input.trim() || attachments.length > 0;
    if (!thread || !hasContent || thread.status === "running") return;

    // Convert attachments to base64
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
                resolve({ name: a.name, base64, mediaType: a.file.type });
              };
              reader.readAsDataURL(a.file);
            }),
        ),
      );
    }

    const effort = thread.provider === "codex" ? codexEffort.id : claudeEffort.id;
    // `selectedModel` can be null during the brief window before the
    // live model list arrives. Omit the model field so the backend
    // falls back to the CLI's own default for the provider.
    onSend(thread.id, input.trim(), images, {
      ...(selectedModel && { model: selectedModel.id }),
      effort,
    });
    setInput("");
    setAttachments((prev) => {
      prev.forEach((a) => URL.revokeObjectURL(a.previewUrl));
      return [];
    });
    // Reset textarea height
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.overflowY = "hidden";
    }
  };

  const handleOpenInEditor = useCallback(
    (target: string, line?: number, editor?: EditorTarget) => {
      const effective = editor ?? preferredEditor;
      window.openclawdex?.openInEditor(target, projectCwd, line, effective).then((res) => {
        if (!res.ok && res.message) {
          // Fall back to a native alert; no toast infra yet.
          alert(res.message);
        }
      });
    },
    [projectCwd, preferredEditor],
  );

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
    const saved = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
    const savedProvider: Provider | undefined = saved?.provider === "claude" || saved?.provider === "codex" ? saved.provider : undefined;
    // For a pending thread, honour whatever provider was last picked by
    // flipping thread.provider if needed. Started threads are locked.
    const isPending = thread.messages.length === 0 && thread.sessionId === undefined;
    const targetProvider = isPending && savedProvider ? savedProvider : thread.provider;
    const list = targetProvider === "claude" ? claudeModels : codexModels;
    console.log("[model-restore] thread=%s provider=%s isPending=%s saved=%o targetProvider=%s list.length=%d", thread.id.slice(0, 8), thread.provider, isPending, saved, targetProvider, list.length);
    if (list.length === 0) { console.log("[model-restore] → skipped (list empty)"); return; }
    const ok =
      selectedModel &&
      selectedModel.provider === targetProvider &&
      list.some((m) => m.id === selectedModel.id);
    if (isPending && targetProvider !== thread.provider) {
      console.log("[model-restore] → flipping thread provider to %s", targetProvider);
      onUpdateThreadProvider?.(thread.id, targetProvider);
    }
    if (ok) { console.log("[model-restore] → already ok, selectedModel=%s", selectedModel?.id); return; }
    const restored = saved?.modelId ? list.find((m) => m.id === saved.modelId) : undefined;
    console.log("[model-restore] → setSelectedModel to %s (fallback=%s)", restored?.id ?? list[0]?.id, !restored);
    setSelectedModel(restored ?? list[0]);
  }, [thread, selectedModel, claudeModels, codexModels, onUpdateThreadProvider]);

  // Restore the effort for the current provider whenever the selected model changes.
  useEffect(() => {
    if (!selectedModel || !thread) return;
    const raw = localStorage.getItem("lastSelection");
    const saved = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
    const base = thread.provider === "codex" ? CODEX_EFFORT : CLAUDE_EFFORT;
    const fallback = thread.provider === "codex" ? CODEX_EFFORT[2] : CLAUDE_EFFORT[1];
    const restored = base.find((e) => e.id === saved?.effortId) ?? fallback;
    console.log("[effort-restore] model=%s provider=%s savedEffort=%s → restored=%s", selectedModel.id, thread.provider, saved?.effortId, restored.id);
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
  }, [thread, selectedModel, claudeModels, codexModels, claudeEffort, codexEffort]);

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
  const isCodex = thread.provider === "codex";
  // A "pending" thread hasn't been committed to the DB yet — no
  // session_init has fired, so no sessionId. Only pending threads can
  // have their model/provider changed; committed threads have a real
  // server-side session and changing the model retroactively doesn't
  // make sense. (`isStarted` alone isn't enough because a committed
  // thread whose history hasn't loaded yet also has messages.length=0.)
  const isStarted = thread.messages.length > 0 || thread.sessionId !== undefined;

  // If the currently-selected model doesn't match the thread's
  // provider (e.g. thread is Codex but we still have Claude Opus
  // picked from the previous thread), fall back to the first model
  // of the thread's provider so the label doesn't lie. May be null
  // while the live list is still loading.
  const displayedModel: ModelDef | null =
    selectedModel && selectedModel.provider === thread.provider
      ? selectedModel
      : (isClaude ? claudeModels[0] : codexModels[0]) ?? null;
  const modelLabel = displayedModel?.label ?? "Loading models…";
  const baseEffortList = isCodex ? CODEX_EFFORT : CLAUDE_EFFORT;
  // Filter the provider's full effort list down to the ones the
  // selected model supports. While no model is resolved yet, show
  // the full base list so the picker isn't empty.
  const effortList = !displayedModel || displayedModel.supportedEfforts === undefined
    ? baseEffortList
    : baseEffortList.filter((e) => displayedModel.supportedEfforts!.includes(e.id));
  const selectedEffort = isCodex ? codexEffort : claudeEffort;
  const setSelectedEffort = isCodex ? setCodexEffort : setClaudeEffort;
  // Hide the effort picker entirely for models that don't support
  // reasoning control (e.g. Claude Haiku).
  const showEffortPicker = effortList.length > 0;

  return (
    <OpenFileContext.Provider value={{ open: handleOpenInEditor, editorLabel: editorLabel(preferredEditor) }}>
    <div
      className="flex-1 flex flex-col min-w-0 min-h-0"
    >
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
                onClick={() => handleOpenInEditor(projectCwd, undefined, preferredEditor)}
                title={`Open project in ${editorLabel(preferredEditor)}`}
                className="flex items-center justify-center pl-2.5 pr-1 transition-colors"
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <EditorTargetIcon target={preferredEditor} size={16} />
              </button>
              <button
                ref={editorCaretRef}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!editorDropdownOpen && editorCaretRef.current) {
                    const rect = editorCaretRef.current.getBoundingClientRect();
                    setEditorDropdownPos({
                      top: rect.bottom + 4,
                      right: window.innerWidth - rect.right,
                    });
                  }
                  setEditorDropdownOpen((v) => !v);
                }}
                title="Open project in…"
                className="flex items-center justify-center pl-1 pr-2 transition-colors"
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <CaretDown size={12} weight="bold" style={{ color: "var(--text-muted)" }} />
              </button>
            </div>
            {editorDropdownOpen && editorDropdownPos && createPortal(
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
      <ScrollArea ref={scrollAreaRef} className="flex-1" onScroll={handleMessagesScroll}>
        {thread.messages.length === 0 && thread.historyLoaded ? (
          <div
            key={thread.id}
            className="flex items-center justify-center h-full text-[13px]"
            style={{ color: "var(--text-muted)", animation: "fadeIn 120ms ease" }}
          >
            Start a conversation
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
                thread.status === "running" && msgs[msgs.length - 1]?.role === "assistant"
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
                    />
                  );
                  i++;
                } else {
                  // Collect full assistant turn (assistant + tool_use messages)
                  const turnStart = i;
                  while (
                    i < msgs.length &&
                    (msgs[i].role === "assistant" || msgs[i].role === "tool_use")
                  ) {
                    i++;
                  }
                  const turnMsgs = msgs.slice(turnStart, i);

                  // Find the last assistant message for the hover bar
                  const lastAssistantMsg = turnMsgs.reduce<Message | undefined>(
                    (last, m) => (m.role === "assistant" ? m : last),
                    undefined
                  );
                  // Turn is complete if there are more messages after it, or thread is idle
                  const isTurnComplete = i < msgs.length || thread.status === "idle";

                  rendered.push(
                    <div key={`turn-${msg.id}`} className="group/turn">
                      {turnMsgs.map((m) => {
                        // Render AskUserQuestion tool calls as interactive cards
                        if (m.role === "tool_use" && m.toolName === "AskUserQuestion") {
                          const hasUserMsgAfter = msgs.slice(i).some((later) => later.role === "user");
                          return (
                            <QuestionCard
                              key={m.id}
                              toolInput={m.toolInput}
                              alreadyAnswered={hasUserMsgAfter}
                              onSubmit={(text) => {
                                if (thread.pendingToolUseId) {
                                  onRespondToTool(thread.id, thread.pendingToolUseId, text);
                                } else {
                                  onSend(thread.id, text);
                                }
                              }}
                            />
                          );
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
                      {lastAssistantMsg && isTurnComplete && (
                        <div className="-mt-4 px-1 transition-opacity duration-300 opacity-0 group-hover/turn:opacity-100">
                          <MessageHoverBar message={lastAssistantMsg} />
                        </div>
                      )}
                    </div>
                  );
                }
              }
              return rendered;
            })()}
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
            ref={composerRef}
            className="rounded-2xl relative"
            style={{
              background: "var(--surface-2)",
              border: isDragOver
                ? "1px solid var(--accent)"
                : "1px solid var(--border-default)",
              transition: "border-color 150ms ease",
            }}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {/* Drag overlay */}
            {isDragOver && (
              <div
                className="absolute inset-0 rounded-2xl z-10 flex items-center justify-center pointer-events-none"
                style={{
                  background: "rgba(51, 156, 255, 0.08)",
                }}
              >
                <span
                  className="text-[13px] font-medium px-3 py-1.5 rounded-lg"
                  style={{
                    background: "var(--surface-3)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-emphasis)",
                  }}
                >
                  Drop image to attach
                </span>
              </div>
            )}
            {/* Attachment chips */}
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
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              onPaste={handlePaste}
            />
            {/* Controls */}
            <div className="flex items-center justify-between px-2 pb-2">
              <div className="flex items-center gap-0">
<div className="relative" ref={modelDropdownRef}>
                  <ControlButton
                    onClick={() => !isStarted && setModelDropdownOpen((v) => !v)}
                    tooltip={isStarted ? "Can't change model after thread has started" : undefined}
                  >
                    {isClaude
                      ? <ClaudeIcon className="w-[14px] h-[14px] shrink-0 text-[#D97757]" />
                      : <OpenAIIcon className="w-[13px] h-[13px] shrink-0 text-white/90" />
                    }
                    <span>
                      {modelLabel}
                      {displayedModel?.badge && (
                        <span className="ml-1" style={{ color: "var(--text-faint)" }}>
                          {displayedModel.badge}
                        </span>
                      )}
                    </span>
                    <CaretDown size={10} weight="bold" />
                  </ControlButton>
                  {modelDropdownOpen && !isStarted && displayedModel && (
                    <ModelDropdown
                      sections={[
                        { label: "Anthropic", models: claudeModels },
                        { label: "OpenAI", models: codexModels },
                      ]}
                      selected={displayedModel}
                      onSelect={(m) => {
                        setSelectedModel(m);
                        // Persist the pick so new threads on app
                        // restart default to the same model for this
                        // provider.
                        const selectionToSave = { provider: m.provider, modelId: m.id, effortId: (m.provider === "codex" ? codexEffort : claudeEffort).id };
                        console.log("[model-save] saving lastSelection:", selectionToSave);
                        localStorage.setItem("lastSelection", JSON.stringify(selectionToSave));
                        // Flip the thread's provider to match the picked
                        // model. Only effective on pending (uncommitted)
                        // threads; committed threads already have
                        // isStarted=true and the dropdown is disabled.
                        if (m.provider !== thread.provider) {
                          onUpdateThreadProvider?.(thread.id, m.provider);
                        }
                        setModelDropdownOpen(false);
                      }}
                    />
                  )}
                </div>
                {showEffortPicker && (
                  <div className="relative" ref={effortDropdownRef}>
                    <ControlButton
                      onClick={() => !isStarted && setEffortDropdownOpen((v) => !v)}
                      tooltip={isStarted ? "Can't change effort after thread has started" : undefined}
                    >
                      <span>{selectedEffort.label}</span>
                      <CaretDown size={10} weight="bold" />
                    </ControlButton>
                    {effortDropdownOpen && (
                      <EffortDropdown
                        levels={effortList}
                        selected={selectedEffort}
                        onSelect={(e) => {
                          setSelectedEffort(e);
                          // Remember this effort for the current
                          // model so switching away and back restores
                          // the same choice.
                          if (displayedModel) {
                            const selectionToSave = { provider: displayedModel.provider, modelId: displayedModel.id, effortId: e.id };
                            console.log("[effort-save] saving lastSelection:", selectionToSave);
                            localStorage.setItem("lastSelection", JSON.stringify(selectionToSave));
                          }
                          setEffortDropdownOpen(false);
                        }}
                      />
                    )}
                  </div>
                )}
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
                    disabled={!input.trim() && attachments.length === 0}
                    className="w-[30px] h-[30px] flex items-center justify-center rounded-full transition-colors"
                    style={{
                      background: input.trim() || attachments.length > 0
                        ? "var(--text-primary)"
                        : "var(--surface-3)",
                      color: input.trim() || attachments.length > 0 ? "var(--surface-0)" : "var(--text-faint)",
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
            <StatusButton tooltip="Coming soon">
              <Monitor size={14} weight="regular" />
              <span>Local</span>
              {/* <CaretDown size={10} weight="bold" /> */}
            </StatusButton>
            {thread.branch && (
              <StatusButton tooltip="Coming soon" fadeIn>
                <GitBranch size={14} weight="regular" />
                <span>{thread.branch}</span>
                {/* <CaretDown size={10} weight="bold" /> */}
              </StatusButton>
            )}
            {thread.contextStats && (
              <TokenProgressIndicator stats={thread.contextStats} />
            )}
          </div>
        </div>
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

function StatusButton({ children, tooltip, fadeIn }: { children: React.ReactNode; tooltip?: string; fadeIn?: boolean }) {
  return (
    <div className="relative group/status" style={fadeIn ? { animation: "fadeIn 200ms ease" } : undefined}>
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
          style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--border-emphasis)" }}
        >
          {tooltip}
        </div>
      )}
    </div>
  );
}

function ControlButton({ children, onClick, tooltip }: { children: React.ReactNode; onClick?: () => void; tooltip?: string }) {
  return (
    <div className="relative group/ctrl">
      <button
        onClick={onClick}
        className="flex items-center gap-1.5 px-2 py-[5px] rounded-xl text-[13px] font-medium transition-colors hover:bg-[var(--border-subtle)] hover:text-[rgba(255,255,255,0.60)]"
        style={{ color: "var(--text-muted)" }}
      >
        {children}
      </button>
      {tooltip && (
        <div
          className="absolute bottom-full left-0 mb-1.5 px-2.5 py-1.5 rounded-lg text-[12px] whitespace-nowrap opacity-0 group-hover/ctrl:opacity-100 transition-opacity duration-150 pointer-events-none z-50"
          style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--border-emphasis)" }}
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
      { id: "cursor", label: "Cursor", icon: <span style={{ color: "var(--text-primary)" }}><CursorIcon size={14} /></span> },
    ],
    [
      { id: "terminal", label: "Terminal", icon: <TerminalIcon size={14} /> },
      { id: "iterm", label: "iTerm2", icon: <ITermIcon size={14} /> },
      { id: "ghostty", label: "Ghostty", icon: <GhosttyIcon size={14} /> },
    ],
    [
      { id: "finder", label: "Finder", icon: <FinderIcon size={14} /> },
    ],
  ];
  return (
    <div
      className="fixed z-[70] rounded-2xl overflow-hidden p-1.5"
      onClick={(e) => e.stopPropagation()}
      style={{
        top,
        right,
        minWidth: "160px",
        background: "rgba(32,32,32,0.98)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 8px 30px rgba(0,0,0,0.55), 0 0 0 0.5px rgba(255,255,255,0.06)",
        backdropFilter: "blur(20px)",
      }}
    >
      {groups.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && (
            <div className="my-1 mx-1.5" style={{ height: 1, background: "rgba(255,255,255,0.08)" }} />
          )}
          {group.map((it) => (
            <button
              key={it.id}
              onClick={() => onSelect(it.id)}
              className="flex items-center gap-2.5 w-full px-3 py-[8px] text-[13px] font-medium text-left rounded-lg transition-colors"
              style={{ color: "rgba(255,255,255,0.85)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span className="flex items-center justify-center w-[16px] h-[16px] shrink-0">{it.icon}</span>
              {it.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Model dropdown ─────────────────────────────────────────── */

interface ModelSection {
  label: string;
  models: ModelDef[];
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
    <div
      className="absolute bottom-full left-0 mb-2 rounded-2xl p-1.5 w-[300px] z-50 flex flex-col gap-[2px]"
      style={{
        background: "var(--surface-3)",
        border: "1px solid var(--border-emphasis)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      {sections.map((section, sIdx) => (
        <div key={section.label} className="flex flex-col gap-[2px]">
          {sIdx > 0 && (
            <div className="my-1 h-px" style={{ background: "var(--border-subtle)" }} />
          )}
          <div
            className="text-[10px] font-semibold uppercase tracking-wider px-2.5 pt-1 pb-0.5"
            style={{ color: "var(--text-muted)" }}
          >
            {section.label}
          </div>
          {section.models.map((m) => {
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
                {m.provider === "claude"
                  ? <ClaudeIcon className="w-[20px] h-[20px] shrink-0 mt-0.5 text-[#D97757]" />
                  : <OpenAIIcon className="w-[18px] h-[18px] shrink-0 mt-0.5 text-white/90" />
                }
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <span
                    className="text-[13px] font-medium leading-tight"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {m.provider === "claude" ? `Claude ${m.label}` : m.label}
                    {m.badge && (
                      <span
                        className="ml-1.5 text-[11px] font-medium"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {m.badge}
                      </span>
                    )}
                  </span>
                  <span
                    className="text-[11px] font-medium leading-tight truncate"
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
      ))}
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
        const isDisabled = !!mode.comingSoon;
        return (
          <button
            key={mode.id}
            onClick={() => !isDisabled && onSelect(mode)}
            className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors"
            style={{
              background: isSelected ? "rgba(255,255,255,0.06)" : "transparent",
              cursor: isDisabled ? "default" : "pointer",
              opacity: isDisabled ? 0.38 : 1,
            }}
            onMouseEnter={(e) => {
              if (!isDisabled) e.currentTarget.style.background = "rgba(255,255,255,0.06)";
            }}
            onMouseLeave={(e) => {
              if (!isDisabled) e.currentTarget.style.background = isSelected ? "rgba(255,255,255,0.06)" : "transparent";
            }}
          >
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <span className="flex items-center gap-2">
                <span
                  className="text-[13px] font-medium leading-tight"
                  style={{ color: "var(--text-primary)" }}
                >
                  {mode.label}
                </span>
                {isDisabled && (
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wide leading-none px-1.5 py-0.5 rounded-md"
                    style={{
                      color: "var(--text-muted)",
                      background: "rgba(255,255,255,0.06)",
                    }}
                  >
                    Coming soon
                  </span>
                )}
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

