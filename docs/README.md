# OpenNapse Documentation

Everything you need to clone, run, understand, and contribute to OpenNapse.

OpenNapse is an idea-to-project workspace built around one loop: **capture → promote → plan → ship**. It runs fully in the browser by default (no account, no backend), and the same codebase can self-host with Docker or back onto Supabase for auth and teams.

## Start here

| Doc | Read it when you want to |
|-----|--------------------------|
| [Getting Started](./getting-started.md) | Clone the repo, install, run the app, and walk through your first idea-to-ship loop. |
| [Project Structure](./project-structure.md) | Understand the monorepo layout and where everything lives. |
| [The Views](./views.md) | Tour the 7 views (Capture, Dashboard, Kanban, Notes, Graph, Focus, Stats) plus Settings. |

## Going deeper

| Doc | Topic |
|-----|-------|
| [Data Layer](./data-layer.md) | Domain models, the `DBAdapter` seam, Zustand stores, and how persistence works. |
| [Architecture](./architecture.md) | The core seams and design rules. |
| [AI & BYOK](./ai.md) | The provider registry, bring-your-own-key flow, and how keys stay out of the bundle. |
| [Supabase Backend](./supabase.md) | Auth, RLS, migrations, and Edge Functions for the optional cloud path. |
| [Feature & Plan Matrix](./feature-matrix.md) | What works for self-host, hosted Free, and hosted Pro — and how gating resolves. |
| [MCP Server](./mcp.md) | Agent access: let AI read and improve your ideas, tasks, and resources. |
| [Security](./security.md) | The security baseline and what must hold before cloud/AI ship. |
| [External Providers](./external-providers.md) | Prerequisites before turning on cloud sync, self-hosting, or hosted AI. |

## Build, test, ship

| Doc | Topic |
|-----|-------|
| [Testing & Checks](./testing.md) | Unit tests, e2e, lint, typecheck, build — what to run and when. |
| [Troubleshooting](./troubleshooting.md) | Common setup and dev issues. |
| [Contributing](../CONTRIBUTING.md) | Workflow, code style, and PR rules. |

## Quick reference

```bash
pnpm install          # install deps (pnpm 10+, Node 20+)
pnpm dev              # start the dev server → http://localhost:5173
pnpm test:run         # run the test suite once
pnpm typecheck        # TypeScript project check
pnpm lint             # ESLint
pnpm build            # typecheck + production build
```

No database or account is required for any of the above. The app stores everything in your browser by default.
