# Architecture

OpenNapse is a local-first SPA with optional cloud. The same codebase runs three ways — browser-only, self-hosted with Docker, or backed by Supabase — because persistence sits behind a single swappable interface. The default product works with no auth, no network, and no account.

For the concrete data model and store wiring, see [Data Layer](./data-layer.md). This doc is the higher-level map.

## Core rules

- Local reads and writes work without auth or a network connection.
- UI components never write to storage directly — everything goes through a store → adapter.
- Domain data is validated with Zod before it is persisted.
- Optional capabilities (cloud, hosted AI, teams) are off by default and gated behind explicit interfaces and feature flags.
- Deferred systems stay visible in the product (e.g. sync state shown in Settings) rather than silently faked.

## The seams

| Seam | Directory | Responsibility |
|------|-----------|----------------|
| **Domain** | `apps/web/src/domain/` | Typed entities, Zod validation, pure business logic. No I/O. |
| **Stores** | `apps/web/src/stores/` | Zustand state; the bridge between views and the adapter. |
| **Persistence** | `apps/web/src/db/` | The `DBAdapter` contract + browser-local and Supabase implementations. |
| **Storage backend** | `apps/web/src/db/storage-backend.ts` | IndexedDB ⇄ localStorage behind the adapter. |
| **Sync** | `apps/web/src/sync/` | Sync state + the outbox the future engine will drain. |
| **AI** | `apps/web/src/ai/` | Provider registry, BYOK key handling, consent gates. |
| **Auth** | `apps/web/src/auth/` | Supabase auth, workspace bootstrap, teams, credits, audit. |
| **Config** | `apps/web/src/config/` | Env detection (is Supabase configured?). |
| **Security** | `apps/web/src/security/` | Privacy defaults and input-handling principles. |

## The adapter is the hero

The single most important design decision is the `DBAdapter` interface (`db/adapter.ts`). The UI talks to stores; stores talk to one adapter; the adapter decides where bytes land. Swapping `BrowserLocalAdapter` (IndexedDB) for `SupabaseCloudAdapter` (Postgres + RLS) requires no changes to views or domain logic.

```
Views ──▶ Zustand stores ──▶ DBAdapter ──▶ BrowserLocalAdapter ──▶ IndexedDB / localStorage
                                       └──▶ SupabaseCloudAdapter ──▶ Supabase (gated)
```

This is why "runs anywhere" is true without forking the code. See [Data Layer](./data-layer.md) for the full contract.

## Three deployment shapes

1. **Browser-only** — build static, host anywhere. IndexedDB holds everything. Nothing to operate. (Default.)
2. **Docker** — serve behind nginx (`docker/`). Browser-only by default; pass Supabase build args to light up cloud features.
3. **Supabase** — add auth, team workspaces, and the server-side AI gateway. See [Supabase Backend](./supabase.md).

## Current state vs. staged

| Capability | State |
|-----------|-------|
| Local CRUD (ideas/projects/tasks/notes) | ✅ Live |
| IndexedDB persistence + Zod validation | ✅ Live |
| Voice notes (MediaRecorder) | ✅ Live |
| Kanban scheduling (scheduledDate/dueDate + today/overdue strip) | ✅ Live |
| Focus Sprint (Pomodoro-style timer, linked to task/idea) | ✅ Live |
| Local AI suggestions + Mentor (no LLM) | ✅ Live |
| BYOK hosted AI (consent + session key) | ✅ Live, opt-in |
| Supabase auth + personal workspace bootstrap | ✅ Live (when configured) |
| Supabase schema + RLS + Edge Functions | ✅ Live (when deployed) |
| Team workspaces / invites | 🔴 Disabled locally — reserved for future hosted product |
| Cross-device cloud **sync** | 🟡 Staged — adapter written, **not wired**; `use-sync.ts` returns `coming-soon` |

## Future hardening

- Wire `SupabaseCloudAdapter` into the stores behind a runtime switch, drain the sync outbox, and add conflict handling. (Gate on the [security prerequisites](./external-providers.md#cloud-sync).)
- Consider replacing the whole-collection JSON persistence with a more granular store (e.g. wa-sqlite + OPFS) as data volume grows.
- Per-table RLS ownership tests proving cross-user isolation before sync ships.
- Local Ollama/embedding AI providers as the privacy-preserving default deepen.

See [Security](./security.md) for the guarantees these seams protect.
