import type { CSSProperties, MouseEvent, ReactNode } from "react";

/**
 * Shared dropdown/menu primitives.
 *
 * Two visual variants exist across the app:
 *
 * - `composer` — the pickers that live in the composer and the inline
 *   hero project-switcher. Panel uses `var(--surface-3)` with a muted
 *   border and a soft shadow. Items use `rounded-xl` pills with a
 *   0.06 hover tint and primary-text color.
 *
 * - `floating` — context menus and the open-in-editor menu. Panel is
 *   darker translucent (`rgba(32,32,32,0.98)`) with a brighter border,
 *   heavier shadow, and `backdrop-blur`. Items are slightly tighter
 *   (`rounded-lg`, 8px vertical padding) with a 0.07 hover tint on an
 *   85%-white label.
 *
 * Every item renders at `text-[13px] font-medium` — this is the single
 * source of truth for picker typography. Do not re-declare the weight
 * at call sites.
 *
 * Positioning is intentionally left to the caller (pass `className` /
 * `style`): some menus are `fixed` with computed coords, others are
 * `absolute bottom-full`, others are `absolute top-full left-1/2`.
 */

type Variant = "composer" | "floating";

const SURFACE_STYLE: Record<Variant, CSSProperties> = {
  composer: {
    background: "var(--surface-3)",
    border: "1px solid var(--border-emphasis)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
  },
  floating: {
    background: "rgba(32,32,32,0.98)",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow:
      "0 8px 30px rgba(0,0,0,0.55), 0 0 0 0.5px rgba(255,255,255,0.06)",
    backdropFilter: "blur(20px)",
  },
};

const ITEM_HOVER: Record<Variant, string> = {
  composer: "rgba(255,255,255,0.06)",
  floating: "rgba(255,255,255,0.07)",
};

const ITEM_COLOR: Record<Variant, string> = {
  composer: "var(--text-primary)",
  floating: "rgba(255,255,255,0.85)",
};

const ITEM_LAYOUT: Record<Variant, string> = {
  composer: "rounded-xl px-2.5 py-2 gap-2.5",
  floating: "rounded-lg px-3 py-[8px] gap-2.5",
};

export function DropdownSurface({
  variant,
  children,
  className,
  style,
  onClick,
  onMouseDownCapture,
}: {
  variant: Variant;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
  onMouseDownCapture?: (e: MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={`rounded-2xl p-1.5 flex flex-col gap-[2px] ${className ?? ""}`}
      style={{ ...SURFACE_STYLE[variant], ...style }}
      onClick={onClick}
      onMouseDownCapture={onMouseDownCapture}
    >
      {children}
    </div>
  );
}

export function DropdownItem({
  variant,
  selected = false,
  disabled = false,
  align = "center",
  onClick,
  children,
  className,
  style,
}: {
  variant: Variant;
  selected?: boolean;
  disabled?: boolean;
  /** Cross-axis alignment. Use "start" when the item has a multi-line stack (e.g. Model picker icon + subtitle). */
  align?: "center" | "start";
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const hover = ITEM_HOVER[variant];
  const alignCls = align === "start" ? "items-start" : "items-center";
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      className={`w-full flex ${alignCls} text-left text-[13px] font-medium transition-colors ${ITEM_LAYOUT[variant]} ${className ?? ""}`}
      style={{
        background: selected ? hover : "transparent",
        color: ITEM_COLOR[variant],
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.38 : 1,
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = hover;
      }}
      onMouseLeave={(e) => {
        if (!disabled)
          e.currentTarget.style.background = selected ? hover : "transparent";
      }}
    >
      {children}
    </button>
  );
}

export function DropdownDivider({ variant }: { variant: Variant }) {
  if (variant === "composer") {
    return (
      <div
        className="my-1 h-px"
        style={{ background: "var(--border-subtle)" }}
      />
    );
  }
  return (
    <div
      className="my-1 mx-1.5"
      style={{ height: 1, background: "rgba(255,255,255,0.08)" }}
    />
  );
}

/**
 * Section label for grouped menus (e.g. "Anthropic" / "OpenAI" in the
 * model picker). Visual-only — not a semantic header.
 */
export function DropdownSectionHeader({ children }: { children: ReactNode }) {
  return (
    <div
      className="text-[10px] font-semibold uppercase tracking-wider px-2.5 pt-1 pb-0.5"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </div>
  );
}
