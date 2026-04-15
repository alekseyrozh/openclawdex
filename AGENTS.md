# OpenClawdex

Desktop UI for orchestrating Claude and Codex coding agents through their CLIs.

## What this is

An Electron app that will spawn `claude` and `codex` CLI processes as backends, presenting a unified chat UI to manage multiple agent threads in parallel.

The UI is currently a **static mockup** — no CLI integration yet. The goal is a native Mac feel.

## Architecture

pnpm monorepo with two apps:

- **`apps/web`** — React + Vite + Tailwind v4 frontend. This is the UI that gets loaded inside Electron (via `http://localhost:3000` in dev).
- **`apps/desktop`** — Electron shell. Provides native macOS window chrome (hiddenInset title bar, vibrancy sidebar, traffic lights). Compiles with `tsc` to `dist/`.

### Key files

- `apps/web/src/App.tsx` — Root layout, mock thread data, draggable sidebar resize
- `apps/web/src/components/Sidebar.tsx` — Thread list with collapsible project groups
- `apps/web/src/components/ChatView.tsx` — Message display, file change cards, composer with model/effort pickers
- `apps/web/src/index.css` — Theme tokens (`#181818` surface, `#339CFF` accent, `#FFFFFF` ink)
- `apps/desktop/src/main.ts` — Electron BrowserWindow config
- `apps/desktop/src/preload.ts` — Context bridge (minimal, ready to expand for CLI spawning)

## Running

```bash
# 1. Install deps
pnpm install

# 2. Start Vite dev server
pnpm dev

# 3. In another terminal, launch Electron
cd apps/desktop && npx tsc && npx electron .
```

The Electron window loads from `http://localhost:3000`. Hot reload works — edit the web app and it updates in the Electron window.

## Theme

Dark theme with blue accent:

- Surface: `#181818`
- Accent: `#339CFF`
- Ink/foreground: `#FFFFFF` (used via opacity layers: 0.95, 0.75, 0.50, 0.28)
- Diff added: `#40c977`, removed: `#fa423e`
- UI font: `-apple-system, BlinkMacSystemFont` at 13px
- Code font: `ui-monospace, "SFMono"` at 12px
- Translucent sidebar (Electron vibrancy)

All tokens are CSS custom properties in `index.css`.

## Icons

Using **Phosphor Icons** (`@phosphor-icons/react`) with `weight="light"` for a soft, rounded feel. Carets use `weight="bold"`, send/stop buttons use `weight="bold"`/`weight="fill"`.

## Planned CLI integration

The plan is to spawn both agents as subprocesses from the Electron main process:

| Agent | Method | Auth |
|---|---|---|
| Claude | `claude -p` with `--output-format stream-json` | User's existing `claude auth login` (Max plan works) |
| Codex | `codex app-server` (JSON-RPC over stdout) | User's existing `codex login` |

No OAuth, no API keys to manage — relies entirely on existing CLI logins.

## Code rules

- **Zod for all external data.** Any data whose shape you don't fully control — CLI stdout, IPC messages from another process, JSON parsed from files, API responses — MUST be validated with a Zod schema before use. Define the schema first, then derive the TypeScript type from it with `z.infer<>`. Never trust `as` casts or hand-written interfaces for external boundaries.

## Design decisions

- Sidebar is draggable (min 180px, max 400px)
- No top-left rounding on main content panel (caused visual artifacts with vibrancy)
- Sidebar uses semi-transparent background (`rgba(24,24,24,0.5)`) so Electron vibrancy blur shows through
- `html`/`body` background is transparent to allow vibrancy
- Main content area is opaque `#181818`
- File change cards are first-class UI elements (not inline tool call text)
- User messages in subtle dark cards (`rounded-3xl`), assistant messages are plain text
- Inline code refs styled as accent-blue for file paths, warm orange for other code
