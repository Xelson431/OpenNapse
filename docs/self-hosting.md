# Self-Hosting OpenNapse

OpenNapse is local-first. It runs with zero backend, and you add your own
Supabase only if you want accounts, cloud sync, and team workspaces. Nothing in
this repo depends on OpenNapse's hosted infrastructure — everything here works
for a self-hoster with only their own Supabase (or fully local).

This guide is the operator runbook: install, upgrade, back up, restore, rotate
keys, and harden for production.

## The three ways it runs

| Mode | Backend | What you get |
| --- | --- | --- |
| **Local-only** | Browser IndexedDB | Everything offline. No auth, no sync, no teams. |
| **Self-host + Supabase** | Your Supabase project | Accounts, cloud sync, team workspaces, generous limits. |
| **Hosted** | OpenNapse Supabase + private billing wrapper | Paid tiers. Not part of this repo. |

Capabilities key off **dependencies present** (Supabase linked) and server
`entitlement_limits`, never off "is this the hosted product". With no
`VITE_BILLING_URL`, the UI shows zero Pro/billing surface.

## 1. First install

### Prerequisites
- Node 20+
- pnpm 10+
- (Cloud features only) A Supabase project — Supabase Cloud or the self-hosted
  Supabase Docker stack.

### Local-only (no backend)
```bash
pnpm install
pnpm dev            # http://localhost:5173
```
That is the whole setup for offline use. Data lives in IndexedDB.

### With Docker (static build behind nginx)
```bash
cp .env.example .env     # leave values blank for local-only
docker compose up --build
# http://localhost:8080  (health probe at /healthz)
```
To bake in cloud config, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
in `.env` before building. `VITE_*` values are public and embedded in the
bundle — never put service-role or provider keys there.

### With your own Supabase (cloud features)
1. Create a Supabase project (or start the self-hosted stack).
2. Link and apply the schema:
   ```bash
   supabase link --project-ref YOUR_REF
   supabase db push
   ```
3. Deploy the Edge Functions:
   ```bash
   supabase functions deploy bootstrap-personal-workspace
   supabase functions deploy invite-member
   supabase functions deploy accept-invite
   supabase functions deploy test-provider-connection
   supabase functions deploy run-ai-action
   ```
4. Set Edge Function secrets (see [Key rotation](#5-key-rotation)).
5. Build the web app with your project's URL + anon key.

Local Supabase dev is also supported now that `supabase/config.toml` is
committed:
```bash
supabase start
supabase db reset      # applies every migration to a fresh local DB
supabase status        # prints local API URL + anon/service-role keys
```

## 2. Upgrades

Migrations are **forward-only and additive** (`create ... if not exists`,
`add column if not exists`, `create or replace function`). There are no
destructive down-migrations, so applying a newer release is safe:

```bash
git pull
pnpm install
supabase db push        # applies any new migrations
supabase functions deploy <changed functions>
pnpm build              # or: docker compose up --build
```

Always run `supabase db push --dry-run` first if you want to preview which
migrations will apply. If `db push` reports remote migrations missing locally,
your local checkout is behind — pull before pushing.

### Hosted-only override (not for self-host)
The private `opennapse-billing` repo ships an `entitlement_limits` override
that must be applied **after** every public migration. Self-hosters never apply
it; the public `entitlement_limits` already returns generous limits.

## 3. Backup and restore

You have two independent layers. Use both.

### A. Full database backup (authoritative)
Supabase is Postgres. Back up the whole project database:
```bash
# Schema + data
supabase db dump --file backup.sql
# Data only (roles/schema managed by migrations)
supabase db dump --data-only --file data.sql
```
`pg_dump` against the project connection string works too. Store dumps
encrypted and off-box. Automate on a schedule (cron/CI) — there is no built-in
scheduler.

Restore into a fresh project:
```bash
supabase db reset          # local: rebuild schema from migrations
psql "$DATABASE_URL" -f data.sql
```

### B. Per-workspace JSON export (user-facing)
In the app: **Settings → Data → Export**. This writes a portable JSON file
(ideas, projects, tasks, notes, and idea resources). Import restores them into
the active workspace. This is per-workspace and content-only — it is a
convenience/migration tool, not a substitute for a database backup.

> Never treat "clear IndexedDB" or a factory reset as a recovery step. Export
> first.

## 4. Recovery

| Situation | Action |
| --- | --- |
| Local content wrong/corrupt | Settings → Data → Export (if possible), then Import a known-good JSON. |
| Cloud workspace needs deletion | Use the delayed, cancelable lifecycle in Settings (30-day window), not a manual DELETE. |
| Bad database state | Restore from the most recent `supabase db dump` (§3A). |
| Migration applied in error | Write a new forward migration that corrects it. Do not hand-edit an applied migration file. |

## 5. Key rotation

- **Anon key / service-role key**: rotate in the Supabase dashboard. Update the
  anon key in your build env (`VITE_SUPABASE_ANON_KEY`) and the service-role key
  wherever Edge Functions read it.
- **Edge Function secrets**: never commit them. Set via the CLI:
  ```bash
  supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
  supabase secrets set HOSTED_AI_ENABLED=false
  ```
- **BYOK provider keys**: entered per-session in Settings, held in memory only,
  never persisted to localStorage or the bundle. Workspace-scoped provider
  configs reference Supabase Vault (`vault_secret_id`) — rotate the Vault entry,
  not a plaintext column.
- The service-role key must **never** reach the browser or the `VITE_*` env.

## 6. Email and auth config

Cloud sign-in uses Supabase magic links. On the self-hosted Supabase stack you
must configure SMTP or no emails are delivered:
- Dashboard → Authentication → SMTP settings, or the `[auth.email.smtp]` block
  in `supabase/config.toml` for local dev.
- Set the site URL / redirect allow-list to your deployed origin. Locally these
  default to `http://localhost:5173` (see `[auth]` in `config.toml`).

## 7. Verifying RLS (security)

Row-Level Security is deny-by-default on every user table. A live integration
suite exercises cross-user isolation, roles, team-derived access, seat limits,
idempotency, and attribution.

Run it against a disposable database:
```bash
supabase start
supabase db reset
supabase status -o env > .supabase.env
set -a && source .supabase.env && set +a
SUPABASE_TEST_URL="$API_URL" \
SUPABASE_TEST_ANON_KEY="$ANON_KEY" \
SUPABASE_TEST_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
pnpm --filter @opennapse/web exec vitest run src/db/rls.integration.test.ts
```
Without those env vars the suite skips (it never runs against a real project by
accident). CI runs this automatically on every push against a fresh Supabase
instance — see `.github/workflows/ci.yml`.

## 8. Local development

```bash
pnpm dev            # Vite dev server + HMR
pnpm typecheck      # tsc -b
pnpm lint           # eslint
pnpm test:run       # vitest (unit; RLS suite skips without a DB)
pnpm build          # typecheck + production build
```
Edge Functions run locally with `supabase functions serve`. The Deno functions
under `supabase/functions/` are intentionally outside the web tsconfig; editor
`Deno` / `jsr:` warnings there do not affect `pnpm build`.

## 9. Observability

- **App health**: nginx serves `GET /healthz` (used by the compose healthcheck)
  for load-balancer probes.
- **Audit log**: security-sensitive actions (workspace/team lifecycle, invites,
  ownership transfer) write to `audit_logs`, readable by workspace admins in
  Settings.
- **Client logs**: in-app Logs view; export as JSON from there.

## 10. Production hardening checklist

- [ ] TLS in front of the app (Caddy, Traefik, nginx, or Cloudflare Tunnel).
- [ ] `VITE_BILLING_URL` unset unless you run the private billing wrapper.
- [ ] Service-role key set only via `supabase secrets set`, never in `VITE_*`.
- [ ] SMTP configured so magic-link sign-in actually delivers.
- [ ] Scheduled `supabase db dump` backups, stored encrypted off-box.
- [ ] RLS integration suite green against your project before go-live.
- [ ] CSP is enabled in `docker/nginx.conf`; add any extra AI provider hosts you
      use to `connect-src`.
- [ ] Rate limits: server-side write throttles are enforced in the database;
      keep them.
- [ ] Review `docs/feature-matrix.md` before changing any gated capability.

## Related docs
- [getting-started.md](getting-started.md) — first run walkthrough
- [supabase.md](supabase.md) — cloud schema and Edge Functions
- [security.md](security.md) — threat model and RLS posture
- [feature-matrix.md](feature-matrix.md) — self-host vs hosted capabilities
- [teams.md](teams.md) — collaboration model
- [troubleshooting.md](troubleshooting.md) — common issues
