# Project Structure

OpenNapse is a pnpm monorepo. It contains the web app (`apps/web`), an optional MCP server (`apps/mcp`), plus Supabase backend scaffolding and docs.

## Top-level layout

```
OpenNapse/
├── apps/
│   ├── web/              The React 19 + Vite + TypeScript app (the whole product)
│   └── mcp/              Model Context Protocol server (stdio) for AI agent access
├── supabase/
│   ├── migrations/       Postgres schema: workspaces, content tables, idea resources, RLS, ops tables
│   └── functions/        Edge Functions: AI gateway, invites, workspace bootstrap
├── docker/               Self-host scaffolding (Dockerfile + nginx config)
├── docs/                 You are here
├── AGENTS.md             Project-local rules for AI agents and contributors
├── CONTRIBUTING.md       Contribution workflow and code style
├── SECURITY.md           Vulnerability reporting
├── README.md             Project overview
└── package.json          Workspace root scripts
```

## Root scripts

The root `package.json` proxies into `apps/web`:

| Script | Runs |
|--------|------|
| `pnpm dev` | `--filter @opennapse/web dev` |
| `pnpm build` | `--filter @opennapse/web build` |
| `pnpm typecheck` | `--filter @opennapse/web typecheck` |
| `pnpm test` / `pnpm test:run` | Vitest (watch / one-shot) |
| `pnpm lint` | ESLint |
| `pnpm electron:dev` / `pnpm electron:build` | Desktop dev / packaging |

## Inside `apps/web/src`

```
apps/web/src/
├── App.tsx              The app shell + all 7 views + modals (single large file)
├── main.tsx             React entry point
├── domain/              Zod-validated models + pure business logic (NO I/O)
│   ├── ideas.ts         Idea schema, temperature, draft factory
│   ├── projects.ts      Project schema, createProjectFromIdea
│   ├── tasks.ts         Task schema, columns, createFirstStepTask
│   ├── notes.ts         Note schema, voice recordings
│   ├── workspaces.ts    Workspace records + modes
│   ├── stats.ts         Momentum score, idea-to-reality ratio
│   ├── mentor.ts        Local keyword-routed assistant (no LLM)
│   ├── ai.ts            Local rule-based suggestions
│   └── features.ts      Feature registry (sync/self-host/ai = coming-soon)
├── stores/              Zustand state
│   ├── use-ideas-store.ts        Ideas list
│   ├── use-workspace-store.ts    Projects, tasks, notes
│   └── use-workspaces-store.ts   Workspace records + active workspace id
├── db/                  Persistence seam
│   ├── adapter.ts                DBAdapter interface (the contract)
│   ├── browser-local-adapter.ts  IndexedDB/localStorage impl (the live one)
│   ├── supabase-cloud-adapter.ts Supabase impl (fully written, gated)
│   └── storage-backend.ts        IndexedDB ⇄ localStorage backend seam
├── ai/                  AI provider registry, BYOK gates, action costs
│   ├── provider.ts               8 providers, key handling, consent gate
│   └── action-costs.ts           Daily free credits + per-action cost
├── auth/                Supabase auth, teams, credits, audit, bootstrap
├── sync/
│   └── use-sync.ts               Sync status (currently 'coming-soon')
├── config/
│   └── env.ts                    Supabase env detection
├── lib/
│   ├── supabase.ts               Memoized browser client (null unless configured)
│   └── drag.ts                   Drag helpers
├── security/
│   └── privacy.ts                Privacy-off-by-default constants + principles
├── components/
│   └── Icon.tsx                  Inline-SVG icon set
└── test/
    └── setup.ts                  Vitest setup
```

## A note on `App.tsx`

Most of the UI lives in one large `App.tsx`. There is **no router** — the app keeps an `activeView` state (typed by a `ViewId` enum) and conditionally renders one of seven view components. The views, modals, command palette, and settings panel are all defined as functions inside this file.

This is intentional for a local-first SPA of this size, but it's the first place a contributor will spend time. See [The Views](./views.md) for a map of what's where.

The only UI extracted into its own file today is `components/Icon.tsx`.

## The three architectural seams

If you remember nothing else, remember these three boundaries:

1. **`domain/`** — pure schemas and logic. No storage, no network. Safe to unit test in isolation.
2. **`db/` (`DBAdapter`)** — the only path to persistence. Components and stores never touch `localStorage` or Supabase directly.
3. **`ai/` + `auth/` + `config/`** — the optional, gated capabilities (hosted AI, cloud). Off by default.

See [Architecture](./architecture.md) and [Data Layer](./data-layer.md) for the details.
