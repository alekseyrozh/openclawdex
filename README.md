# OpenClawdex

Desktop UI for orchestrating Claude and Codex coding agents through their CLIs., with a native Mac feel.

## Install

Download the latest release for your platform from the [Releases](https://github.com/alekseyrozh/openclawdex/releases) page:

| Platform | Download |
|---|---|
| macOS (Apple Silicon) | `.dmg` |
| macOS (Intel) | `.dmg` |
| Windows | `.exe` installer |
| Linux | `.AppImage` or `.deb` |

### Prerequisites

OpenClawdex spawns CLI agents as subprocesses, so you need at least one installed and authenticated:

- **Claude Code** &mdash; `npm install -g @anthropic-ai/claude-code` then `claude auth login`
- **Codex CLI** &mdash; install and run `codex login`

No API keys needed &mdash; the app uses your existing CLI logins.

### macOS note

The app is not code-signed yet. On first launch macOS may block it. To open it:
1. Right-click the app and choose **Open**
2. Or go to **System Settings > Privacy & Security** and click **Open Anyway**

## Build from source

### Requirements

- Node.js 20+
- [pnpm](https://pnpm.io/) 9+

### Development

```bash
# Install dependencies
pnpm install

# Start the Vite dev server + Electron
pnpm dev:desktop
```

The Electron window loads from `http://localhost:3000`. Hot reload works for the web app.

### Production build

```bash
# Build everything and package the Electron app
pnpm dist
```

Platform-specific builds:

```bash
pnpm dist:mac      # macOS .dmg + .zip
pnpm dist:win      # Windows .exe (NSIS installer)
pnpm dist:linux    # Linux .AppImage + .deb
```

Output goes to `apps/desktop/release/`.

## Architecture

pnpm monorepo with three packages:

```
apps/
  web/       React + Vite + Tailwind v4 frontend
  desktop/   Electron shell + CLI agent integration
packages/
  shared/    Zod schemas for IPC messages
```

The Electron main process spawns `claude` (via Agent SDK with `--output-format stream-json`) and `codex` (via `app-server` JSON-RPC) as subprocesses, bridging their output to the React UI over IPC.

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b my-feature`)
3. Make your changes
4. Run `pnpm dev:desktop` and verify everything works
5. Commit and push
6. Open a pull request

## License

[MIT](LICENSE)
