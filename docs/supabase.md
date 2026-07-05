# Supabase Backend

OpenNapse runs fully without a backend. Supabase is the **optional** cloud path that adds authentication, team workspaces, and a server-side AI gateway. This doc maps what exists and what's wired vs. staged.

> **Status:** Auth, personal workspace bootstrap, RLS policies, runtime cloud-adapter selection, and the AI gateway scaffold are real and wired. Cross-device conflict-resolving **sync** is still staged; signed-in hosted sessions use `SupabaseCloudAdapter` directly, while signed-out/local sessions use IndexedDB.

## Enabling Supabase locally

```bash
# 1. Create a project at https://supabase.com
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

## Env detection

`apps/web/src/config/env.ts` reads exactly two variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

`resolveSupabaseEnv()` classifies the result as `missing` / `partial` / `invalid` / `configured`. Only the **anon** key is read client-side — never a service-role key.

`apps/web/src/lib/supabase.ts` builds a memoized browser client and **returns `null` unless env is `configured`**. So when Supabase isn't set up, every cloud code path no-ops gracefully and the app stays local-only.

## Database schema (`supabase/migrations/`)

Migrations, applied in order:

### 1. Workspace foundation
`20260509000000_workspace_foundation.sql`

- `profiles`, `workspaces`, `workspace_members`.
- RLS enabled on all three.
- Policies: own-profile access, member-read on workspaces, owner-insert.

### 2. Content tables
`20260512000000_content_tables.sql`

- `projects`, `ideas`, `tasks`, `notes`.
- **Every row carries `workspace_id` + `created_by`.**
- Two helper functions gate access: `is_workspace_member()` (read) and `can_edit_workspace()` (write).
- RLS: member-read / editor-write on all content.
- An `updated_at` trigger keeps timestamps fresh.
- Task table includes nullable `scheduled_date` and `due_date` (date-only, no time) for lightweight day-planning. Indexed with filtered indexes (`is not null`) on `(workspace_id, scheduled_date)` and `(workspace_id, due_date)`.

### 3. Task calendar fields (additive)
`20260704000000_task_calendar_fields.sql`

- Adds `scheduled_date date` and `due_date date` columns to `tasks` (if not present from the content migration).
- Creates filtered indexes for workspace-scoped queries.

### 4. Hosted rate limits
`20260706000000_hosted_rate_limits.sql`

- `rate_limit_events` records authenticated direct-table writes.
- `projects`, `ideas`, `tasks`, and `notes` have trigger-level write throttles so frontend-only guards are not the security boundary.

### 5. Generic billing entitlements
`20260706001000_billing_entitlements.sql`

- `billing_plans` and `workspace_subscriptions` model plan state without any Stripe SDK/secrets in the public repo.
- Private hosted billing wrapper writes subscriptions with service role after Stripe webhook verification.

### 3. Ops tables
`20260512000100_ops_tables.sql`

- `workspace_invites` — team invite tokens.
- `ai_provider_configs` — **stores only a `vault_secret_id`, never a plaintext key.**
- `ai_usage_events` — written by service-role only.
- `daily_credit_balances` — the 10/day free-credit ledger.
- `audit_logs` — read-only from the client.

**RLS is the security boundary.** Personal data is private by default; team data is gated by membership. Before any sync ships, cross-user access tests must prove user A cannot read user B's rows (see [Security](./security.md)).

## Edge Functions (`supabase/functions/`)

Secret-bearing and privileged actions run server-side, never in the browser. All use the caller's JWT; sensitive writes use the service role.

| Function | Purpose |
|----------|---------|
| `run-ai-action` | The **sole hosted-AI gateway**. Auth + workspace check, credit enforcement, resolves the provider key from Vault, makes the call, logs usage. Rejects workspace-scoped provider configs where `workspaceId` doesn't match the requesting workspace. |
| `test-provider-connection` | BYOK reachability check. Reads the Vault key for one call; **never returns it**. |
| `invite-member` | Owner/admin creates a `workspace_invite` + token. |
| `accept-invite` | Redeems an invite token into a membership. |
| `bootstrap-personal-workspace` | Server-side personal-workspace bootstrap (profile + workspace + owner membership). |

> The Edge Functions are Deno modules (`jsr:`/`Deno` globals). Your editor's TypeScript server may flag `Cannot find name 'Deno'` because they aren't part of the `apps/web` tsconfig — that's expected and not a build error for the web app.

## Auth (`apps/web/src/auth/`)

| File | Role |
|------|------|
| `use-auth-status.ts` | `useAuthStatus()` — unavailable / loading / signed-out / signed-in. `requestMagicLink()` (OTP), `signOutOfSupabase()`. |
| `ensure-personal-workspace.ts` | Upserts profile, finds/creates a personal workspace + owner membership. |
| `use-personal-workspace-bootstrap.ts` | Runs bootstrap once per signed-in user (idle → bootstrapping → ready/failed). |
| `bootstrap.ts` | `createPersonalWorkspaceBootstrapPlan()` — a **pure** plan (rows to create), easy to test. |
| `teams.ts` | List members/invites; invite/accept via Edge Functions; revoke/remove via direct table updates. |
| `credits.ts` | `getTodayBalance()`, `listRecentUsage()` — read the ledger tables. |
| `audit.ts` | `listAuditLog()` — read-only. |

**Real today:** magic-link sign-in, session detection, personal-workspace bootstrap.
**Gated / preview:** team invites and team workspace mode (`ENABLE_TEAM_WORKSPACES = false` in `App.tsx`, team workspaces hidden from switcher, team creation blocked); credits/audit reads depend on the tables + service-role writes existing.

## What's NOT enabled

- **Conflict-resolving outbox sync.** Signed-in sessions use the cloud adapter directly. The local outbox still exists, but there is no merge/conflict engine that drains local offline edits after a cloud session reconnects.
- **Stripe implementation.** The public repo includes only generic billing tables and inert UI/client wiring. Stripe checkout, portal, and webhook code belongs in a private billing wrapper; see [Hosted Billing Wrapper](./hosted-billing-wrapper.md).

## Wiring sync (future work)

The path is laid out:

1. The `SupabaseCloudAdapter` already implements `DBAdapter`.
2. The `BrowserLocalAdapter` already writes a sync outbox on every mutation.
3. What's missing: an engine that drains the outbox into Supabase, conflict handling, and a runtime switch to select the cloud adapter when signed in.

Before flipping it on, satisfy the [security prerequisites](./external-providers.md#cloud-sync): RLS cross-user tests, table/column allowlists, and visible/recoverable conflicts.
