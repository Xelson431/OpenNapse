# Troubleshooting

Common issues when setting up or working on OpenNapse, and how to fix them.

## Setup

### `pnpm: command not found`
Install pnpm: `npm install -g pnpm`, or see [pnpm.io/installation](https://pnpm.io/installation). OpenNapse requires **pnpm 10+**.

### Wrong lockfile / install errors
This is a **pnpm** workspace. Only `pnpm-lock.yaml` is committed. Do **not** use `npm install` or `yarn` — they create `package-lock.json` / `yarn.lock`, which are rejected. If you accidentally created one, delete it and run `pnpm install`.

### Node version errors
Use **Node 20+**. Check with `node --version`. A version manager like `nvm`, `fnm`, or `volta` makes this easy.

## Dev server

### Port 5173 already in use
Another Vite instance is running. Stop it, or let Vite pick the next free port (it prints the actual URL on start). Don't kill all Node processes.

### Changes not showing up
- Confirm you're editing under `apps/web/src/` (the only app).
- Hard-refresh the browser (HMR usually handles it, but stale state can linger).
- If app **state** looks wrong, it may be persisted in IndexedDB — see "Reset local data" below.

## Local data

### Reset all local data
Your data lives in the browser. To wipe it:
- In-app: **Settings → Privacy and security → Clear all local data**, or
- Browser dev tools: Application → Storage → Clear site data (clears IndexedDB + localStorage).

### Where exactly is my data?
- Primary: **IndexedDB** (via `idb`).
- Fallback: **localStorage** (when IndexedDB is unavailable, e.g. some test runners).
- The active workspace id is in `localStorage` under `OpenNapse:v0:active-workspace-id`.

### "My data disappeared"
Browser storage is origin-scoped. Switching ports, browsers, profiles, or using private/incognito windows gives you a **different** store. Use the same URL and browser profile you created the data in.

## TypeScript / editor noise

### `Cannot find name 'Deno'` / `Cannot find module 'jsr:...'`
These come from `supabase/functions/**` — Deno Edge Functions that are **not** part of the `apps/web` tsconfig. They're expected in your editor and do **not** affect `pnpm typecheck` or `pnpm build` for the web app. Ignore them, or open the functions in a Deno-aware editor setup.

### Typecheck fails after editing domain models
Domain models are Zod schemas with inferred types. If you change a schema, the inferred type changes everywhere it's used. Follow the errors — they're usually pointing at a store or adapter that needs the matching update. Remember the rule: extend the **schema**, then the `DBAdapter` interface, then **both** adapters. See [Data Layer](./data-layer.md).

## Tests

### Vitest can't use IndexedDB
Expected — the test environment falls back to `LocalStorageBackend` (`db/storage-backend.ts`). Write persistence tests against the adapter, not raw IndexedDB.

### Playwright: "browser not found"
Install browsers once: `pnpm --filter @opennapse/web exec playwright install`.

## Supabase / cloud

### Cloud features do nothing
By design, unless configured. `lib/supabase.ts` returns `null` until `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set in `apps/web/.env.local`. Check **Settings → Profile** for the detected status. See [Supabase Backend](./supabase.md).

### "Why isn't my data syncing across devices?"
It isn't supposed to yet. Cross-device sync is **staged, not enabled** — `sync/use-sync.ts` returns `coming-soon` and `syncNow` is a no-op. The `SupabaseCloudAdapter` is written but not wired into the stores. See [Data Layer](./data-layer.md#sync-status).

### `CloudAdapterDisabledError`
Thrown by `SupabaseCloudAdapter` when it's invoked without configured env / sign-in. Today the stores use the local adapter, so you should only hit this if you're explicitly wiring up the cloud path.

## AI

### Hosted AI won't run
`canRunHostedAI()` needs **all three**: consent on, a session key provided, and an accepted request-preview hash. Check **Settings → AI providers**. Missing any one disables it. See [AI & BYOK](./ai.md).

### "Where do I put my API key?"
In the AI settings panel, as a **session key** (held in memory only). Never in `.env`, `VITE_*`, localStorage, or code — those paths are blocked on purpose, and a committed key must be treated as exposed and rotated.

## Still stuck?

- Re-read the relevant doc from the [docs index](./README.md).
- Check existing [issues](https://github.com/Xelson431/OpenNapse/issues).
- Open a new issue with your OS, Node/pnpm versions, and the exact command + error.
