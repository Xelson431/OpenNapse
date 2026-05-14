<p align="center">
  <img src="apps/web/public/favicon.svg" width="64" height="64" alt="OpenNapse logo" />
</p>

<h1 align="center">OpenNapse</h1>

<p align="center">
  <strong>Local-first idea-to-project workspace.</strong><br/>
  Capture raw ideas, promote the ones that matter into projects, plan on a Kanban board, link notes, and track momentum — without shipping your data anywhere by default.
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
  <img src="https://img.shields.io/badge/local--first-yes-purple.svg" alt="Local First" />
  <img src="https://img.shields.io/badge/self--hostable-yes-orange.svg" alt="Self Hostable" />
</p>

---

## Features

🧠 **Brain Dump** — zero-friction idea capture with Space key shortcut  
📁 **Multi-Workspace** — personal + team workspaces, each with its own projects  
📋 **Kanban Board** — native HTML5 drag-and-drop + keyboard movement  
📝 **Linked Notes** — notes connected to ideas and projects with voice memos  
🕸️ **Relationship Graph** — visual brain map with smooth bezier curves and nebula styling  
🎯 **Focus Mode** — daily slots and distraction-free flow  
📊 **Stats & Momentum** — idea-to-reality ratio, export/import JSON  
🤖 **8 AI Providers** — OpenAI, Anthropic, OpenRouter, Mistral, DeepSeek, Groq, Ollama Cloud (BYOK = free)  
🔒 **Privacy-First** — all data stays on your device unless you explicitly enable cloud  
☁️ **Optional Cloud** — Supabase-powered auth, teams, invites, and workspace sync  
🖥️ **Desktop App** — Electron build for Windows, macOS, and Linux  
📱 **PWA** — installable, works offline with service worker  

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

## Self-Hosting

OpenNapse works in two modes:

### 1. Static Deploy (local-only, no backend)

Deploy the built frontend to any static host. All data lives in the user's browser (IndexedDB).

```bash
pnpm build
# Upload apps/web/dist/ to Cloudflare Pages, Vercel, Netlify, or nginx
```

### 2. Full Cloud (auth + teams + AI gateway)

Add Supabase for authentication, team workspaces, and the AI credit system.

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

### Docker (coming soon)

```bash
docker compose up
```

See [`docker/`](./docker/) for the self-host scaffolding.

## Architecture

```
apps/web/          React 19 + Vite + TypeScript frontend
  src/
    domain/        Zod-validated models (ideas, projects, tasks, notes, workspaces)
    stores/        Zustand state management
    db/            DBAdapter interface → BrowserLocalAdapter (IndexedDB) or SupabaseCloudAdapter
    ai/            Provider registry (8 providers), action costs, consent gates
    auth/          Supabase auth hooks, teams service, credits, audit
    components/    Extracted UI components
    lib/           Shared utilities
  electron/        Electron main + preload (compiles to dist-electron/)
  e2e/             Playwright end-to-end tests

supabase/
  migrations/      Postgres schema (workspaces, content tables, RLS, ops tables)
  functions/       Edge Functions (AI gateway, invites, workspace bootstrap)

docs/              Architecture, security, external providers notes
docker/            Self-host scaffolding
```

### Key Design Decisions

- **Local-first by default** — IndexedDB via `idb` wrapper; no backend required
- **Adapter pattern** — `DBAdapter` interface lets the app swap between local and cloud storage
- **Workspace-scoped** — every record has `workspaceId` + `createdBy`; RLS enforces boundaries
- **BYOK AI** — bring your own API key, bypass all credit charges, keys stored in Supabase Vault (never in browser)
- **No secrets in the bundle** — hosted provider keys are session-only in memory; never persisted to storage

## Scripts

| Script | What it does |
|--------|-------------|
| `pnpm dev` | Start Vite dev server |
| `pnpm build` | Typecheck + production build |
| `pnpm typecheck` | TypeScript project check |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest in watch mode |
| `pnpm test:run` | Vitest one-shot (48 tests) |
| `pnpm --filter @opennapse/web electron:dev` | Electron dev mode |
| `pnpm --filter @opennapse/web electron:build` | Package desktop installer |
| `pnpm --filter @opennapse/web exec playwright test` | E2E tests |

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
