# OpenClawdex

Desktop UI for orchestrating Claude and Codex coding agents through their CLIs.

## What this is

An Electron app that spawns `claude` and `codex` CLI processes as backends, presenting a unified chat UI to manage multiple agent threads in parallel.

## Architecture

### How Electron works

Electron apps have two processes inside one app:

- **Main process** (Node.js) — has system access: filesystem, child processes, SQLite. This is `apps/desktop/`.
- **Renderer process** (Chromium) — runs the React UI in a sandboxed browser window. This is `apps/web/`.

**IPC** is Electron's built-in message passing between these two processes — not HTTP, not a server, just cross-process function calls within the same app. The renderer calls `ipcRenderer.invoke("threads:pin", ...)`, the main process handles it via `ipcMain.handle("threads:pin", ...)`.

The **preload script** (`preload.ts`) bridges the two: it exposes a `window.openclawdex` object to the renderer with specific allowed methods. The renderer can't access Node.js directly (security sandbox).

### Monorepo layout

pnpm monorepo with two apps and a shared package:

- **`apps/web`** — React + Vite + Tailwind v4 frontend. This is the UI that gets loaded inside Electron (via `http://localhost:3000` in dev).
- **`apps/desktop`** — Electron shell. Provides native macOS window chrome (hiddenInset title bar, vibrancy sidebar, traffic lights), SQLite database (Drizzle ORM), and IPC handlers for CLI integration. Compiles with `tsc` to `dist/`.
- **`packages/shared`** — Zod schemas shared between web and desktop (IPC events, session types, project types).

### Key files

- `apps/web/src/App.tsx` — Root layout, thread state management, IPC event handling, draggable sidebar resize
- `apps/web/src/components/Sidebar.tsx` — Thread list with collapsible project groups, pinned threads section
- `apps/web/src/components/ChatView.tsx` — Message display, file change cards, composer with model/effort pickers
- `apps/web/src/index.css` — Theme tokens (`#181818` surface, `#339CFF` accent, `#FFFFFF` ink)
- `apps/web/src/ipc.d.ts` — TypeScript declarations for the preload bridge (`window.openclawdex`)
- `apps/desktop/src/main.ts` — Electron BrowserWindow config, IPC handlers, Claude CLI session management
- `apps/desktop/src/preload.ts` — Context bridge exposing IPC methods to the renderer
- `apps/desktop/src/claude.ts` — Claude CLI binary detection and session wrapper
- `apps/desktop/src/db/schema.ts` — Drizzle ORM schema (projects, projectFolders, knownThreads)
- `apps/desktop/src/db/index.ts` — Database initialization and migration runner
- `apps/desktop/drizzle/` — SQL migration files
- `packages/shared/src/schemas/ipc.ts` — Zod schemas for IPC events and session data

### Database

SQLite via **Drizzle ORM** + **@libsql/client**, stored at `~/Library/Application Support/@openclawdex/desktop/openclawdex.db`.

Tables:
- `projects` — project metadata (id, name)
- `project_folders` — folder paths per project
- `known_threads` — threads started from this UI (session ID, project association, custom name, context stats, pinned/archived state)

Migrations run automatically on app startup via `initDb()`. To change the schema:

1. Edit `apps/desktop/src/db/schema.ts`
2. Run `cd apps/desktop && pnpm db:generate` — this auto-generates the migration SQL and snapshot files
3. **Never** create migration files by hand

### CLI integration

The Electron main process spawns both Claude and Codex as subprocesses:

| Agent | Method | Auth |
|---|---|---|
| Claude | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) wrapping `claude -p --output-format stream-json` | User's existing `claude auth login` (Max plan works) |
| Codex | OpenAI Codex SDK (`@openai/codex-sdk`) wrapping `codex app-server` JSON-RPC; rollout JSONL at `~/.codex/sessions/**` parsed for history | User's existing `codex login` |

No OAuth, no API keys to manage — relies entirely on existing CLI logins.

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
