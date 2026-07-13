<p align="center">
  <img src="apps/web/public/favicon.svg" width="64" height="64" alt="OpenNapse logo" />
</p>

<h1 align="center">OpenNapse</h1>

<p align="center">
  <strong>The workspace that turns scattered ideas into shipped projects.</strong><br/>
  Capture raw ideas, promote the ones that matter into projects, plan them on a Kanban board, link your notes, and watch your idea-to-reality ratio climb.
</p>

<p align="center">
  <em>Runs anywhere you do — in your browser, on your own server, or backed by Supabase.<br/>
  Same app, same data model, you pick the backend.</em>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#self-hosting">Self-Hosting</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#contributing">Contributing</a> •
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" />
  <img src="https://img.shields.io/badge/runs-browser%20%7C%20docker%20%7C%20supabase-purple.svg" alt="Runs anywhere" />
  <img src="https://img.shields.io/badge/data-yours-orange.svg" alt="Your data" />
</p>

---

## The workflow

OpenNapse is built around one loop: **capture → promote → plan → ship**.

1. 🧠 **Capture** every idea the moment it hits — one keystroke, zero friction. Bad ideas are cheap; losing good ones is expensive.
2. ⬆️ **Promote** the ideas worth pursuing into real projects with a first task already waiting.
3. 📋 **Plan** the work on a Kanban board you can drive entirely from the keyboard.
4. 📝 **Connect** notes (text or voice) to the ideas and projects they belong to.
5. 📊 **See momentum** — your idea-to-reality ratio tells you whether you're shipping or just collecting.

## Why people use it

🗄️ **Your data, your backend** — run it fully in the browser, self-host it with Docker, or back it with Supabase. The storage layer is a swappable adapter, so the same app fits a solo notebook or a team deployment.

🔒 **Private by default** — no telemetry, no account required, no AI calls unless you turn them on. Out of the box, nothing leaves your machine.

🤖 **Bring-your-own-key AI** — wire in OpenAI, Anthropic, Mistral, DeepSeek, Groq, OpenRouter, or Ollama. BYOK means no markup and no middleman, and your keys never get baked into the browser bundle.

🕸️ **A map of your thinking** — every idea, project, note, and task is one connected graph you can actually see.

🤝 **Agent-ready (MCP)** — an optional [Model Context Protocol](./docs/mcp.md) server lets AI agents read your ideas and tasks, see what's in progress, and improve idea descriptions or attach markdown resources — scoped to your account through Row Level Security.

🎯 **Focus mode** — daily slots and a distraction-free surface for the one thing that matters today.

🖥️ **Desktop & installable** — native builds for Windows, macOS, and Linux, plus an installable PWA with an offline app shell.

## Quick Start

```bash
# Clone
git clone https://github.com/Xelson431/OpenNapse.git
cd OpenNapse

# Install dependencies
pnpm install

# Start development server
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173). That's it — no database, no backend, no accounts required.

### Desktop App

```bash
# Dev mode (requires pnpm dev running in another terminal)
pnpm --filter @opennapse/web electron:dev

# Build installer (.exe / .dmg / .AppImage)
pnpm --filter @opennapse/web electron:build
```

## Deploy it your way

OpenNapse runs on three backends from the same codebase. Pick the one that fits.

### 1. Browser-only (no backend)

Build the frontend and host it anywhere static. Every idea, project, note, and task lives in the user's browser via IndexedDB. Nothing to operate, nothing to pay for.

```bash
pnpm build
# Upload apps/web/dist/ to Cloudflare Pages, Vercel, Netlify, or nginx
```

### 2. Docker (self-hosted)

Serve the app behind nginx with one command. Runs browser-only by default; pass Supabase build args to light up cloud features.

```bash
docker compose up --build
# Open http://localhost:8080
```

See [`docker/`](./docker/) for the Dockerfile and nginx config.

### 3. Supabase (auth + teams + AI gateway)

Add Supabase for authentication, team workspaces, and the server-side AI gateway.

```bash
# 1. Create a Supabase project at https://supabase.com
# 2. Copy env vars
cp apps/web/.env.example apps/web/.env.local
# Edit .env.local with your Supabase URL + anon key

# 3. Run migrations
supabase link --project-ref <your-ref>
supabase db push

# 4. Deploy Edge Functions
supabase functions deploy bootstrap-personal-workspace
supabase functions deploy invite-member
supabase functions deploy accept-invite
supabase functions deploy test-provider-connection
supabase functions deploy run-ai-action

# 5. Start
pnpm dev
```

> **Status:** auth, workspace schema, RLS policies, team invites/roles/ownership transfer, workspace lifecycle (delayed cancelable deletion), and the AI gateway are wired up and deployed. Cross-device cloud **sync** is staged behind the adapter and not enabled yet — the app shows its current sync state in Settings so you always know where your data lives.

### Agent access (MCP)

Once Supabase is configured and you're signed in, you can point AI agents at your workspace through the [MCP server](./docs/mcp.md):

```bash
pnpm --filter @opennapse/mcp build
# Configure your agent to launch apps/mcp/dist/index.js with your
# Supabase URL, anon key, and a user access token. See docs/mcp.md.
```

## Architecture

```
apps/web/          React 19 + Vite + TypeScript frontend
  src/
    domain/        Zod-validated models (ideas, projects, tasks, notes, idea resources, workspaces)
    stores/        Zustand state management
    db/            DBAdapter interface → BrowserLocalAdapter (IndexedDB) or SupabaseCloudAdapter
    ai/            Provider registry (BYOK providers), action costs, consent gates
    auth/          Supabase auth hooks, teams service, lifecycle, credits, audit
    components/    Extracted UI components
    lib/           Shared utilities
  electron/        Electron main + preload (compiles to dist-electron/)
  e2e/             Playwright end-to-end tests

apps/mcp/          Model Context Protocol server (stdio) — agent access to ideas/tasks/resources

supabase/
  migrations/      Postgres schema (workspaces, content tables, idea resources, RLS, ops tables)
  functions/       Edge Functions (AI gateway, invites, workspace bootstrap)

docs/              Architecture, security, MCP, external providers notes
docker/            Self-host scaffolding
```

### Key Design Decisions

- **One adapter, three backends** — the `DBAdapter` interface is the heart of the app. `BrowserLocalAdapter` (IndexedDB) and `SupabaseCloudAdapter` implement the same contract, so the UI never knows or cares where data lives.
- **Private by default** — no telemetry, no account, no AI calls until you opt in. Browser-only mode keeps everything on-device.
- **Workspace-scoped** — every record carries `workspaceId` + `createdBy`; Supabase RLS enforces those boundaries server-side.
- **BYOK AI** — bring your own API key to skip credit charges entirely; keys live in Supabase Vault, never the browser.
- **No secrets in the bundle** — hosted provider keys are session-only in memory and never persisted to storage.

## Scripts

| Script | What it does |
|--------|-------------|
| `pnpm dev` | Start Vite dev server |
| `pnpm build` | Typecheck + production build |
| `pnpm typecheck` | TypeScript project check |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest in watch mode |
| `pnpm test:run` | Vitest one-shot |
| `pnpm --filter @opennapse/web electron:dev` | Electron dev mode |
| `pnpm --filter @opennapse/web electron:build` | Package desktop installer |
| `pnpm --filter @opennapse/web exec playwright test` | E2E tests |
| `pnpm --filter @opennapse/mcp build` | Build the MCP server (agent access) |

## Requirements

- Node 20+
- pnpm 10+

## Contributing

We welcome contributions! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before submitting a PR.

## Security

Found a vulnerability? Please report it responsibly. See [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) — use it however you want.

---

<p align="center">
  Built with ❤️ for people who think in ideas, not tasks.
</p>
