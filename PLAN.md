# OpenNapse Hosted Platform Handoff

## Objective

Deliver a safe hosted OpenNapse platform without weakening the local-first
product. The hosted product must support durable cloud workspaces, staged
local-to-cloud merge, cross-device sync, workspace lifecycle controls, and
server-enforced billing/entitlements. It must not claim features before their
runtime contracts and recovery paths are implemented and validated.

## Product Rules

- Local-first remains useful without OpenNapse Stripe billing.
- Export/import and BYOK remain available for self-hosted/local workflows.
- Hosted Free eventually includes one personal workspace, export, BYOK, and
  actual cross-device sync.
- Hosted Pro monetizes teams, admin, managed quotas, support, and approved
  managed AI. It must not remove self-hosted core features.
- No local data is cleared to recover from migration or sync problems.
- No automatic local-to-cloud import, no cloud replacement import, and no
  destructive cloud factory reset.
- Hosted AI remains disabled until provider dispatch and atomic accounting are
  both production-ready.
- Payment failure must not delete data or block export.

## Current State

### Completed Locally, Uncommitted

- Cloud UI says `Cloud connected`, not `Synced`.
- Hosted AI, Stripe checkout, and Stripe webhook behavior are disabled by
  explicit environment gates until their runtime contracts are ready.
- The legacy automatic local-to-cloud import has been removed.
- Signed-in users cannot use replacement import, demo-data replacement, or
  factory reset. These actions remain available for local-only storage.
- Direct cloud workspace deletion is hard-blocked in
  `apps/web/src/db/supabase-cloud-adapter.ts`.
- Local records have stable `logicalId`; existing records fall back to `id`.
- Browser export v2 includes `deviceId`, `localUserId`, all workspaces, all
  content collections, and logical-ID fallback metadata.
- Local outbox entries are workspace-scoped and compact repeated writes while
  retaining a stable mutation ID for retry idempotency.
- A write-free merge preview classifies records as `create`, `update`, `skip`,
  or `conflict`.
- Managed AI credit consumption uses an atomic RPC rather than read-then-write
  balance accounting.
- Edge Function Deno dependency resolution is configured through
  `supabase/functions/deno.json`.
- Sync has a typed bounded pull contract, but it is not activated in the UI.
- Transactional `create_workspace`, ownership transfer, owner-safe member
  removal, seat-limited invite acceptance, and server-only deletion request
  RPCs are implemented in additive migrations.
- Content identity is immutable, cross-workspace references are rejected, and
  `apply_sync_mutations` provides bounded idempotent CAS writes plus change-feed
  emission.
- Server-authoritative merge staging, conflict resolution, commit, relationship
  remapping, and guarded rollback contracts are implemented.
- Cursor-floor recovery and paginated authoritative workspace snapshots are
  implemented for bounded change-feed retention.
- Managed AI now has an idempotent invocation ledger and entitlement-derived
  reservation/refund functions. Provider dispatch remains deliberately gated.
- A post-backfill constraint template and hosted rollout operator runbook are
  included but must not be used before their stated gates pass.

### Current Validation

- `pnpm typecheck` passes.
- Full web test suite passes: 183 tests passed; 7 Supabase-backed tests skipped
  because local Supabase requires Docker.
- Direct Deno check of `supabase/functions/run-ai-action/index.ts` passes with
  `supabase/functions/deno.json`.
- `git diff --check` passes.
- The test suite emits existing React `act(...)` warnings.
- A provider-connection UI test has been intermittent when run inside certain
  full-suite runs, but passes on rerun. Treat it as a test-stability issue, not
  a reason to release without validation.

### Hard Blocker

`supabase status` cannot connect to Docker. Do not apply migrations to a real
hosted project or enable sync/merge/billing features until migrations and RLS
tests run locally and a backup/restore rehearsal is complete.

## Existing Migrations

- `20260711000000_hosted_foundation.sql`
  - Adds `platform_schema_contracts`.
  - Adds nullable `logical_id` to ideas, projects, tasks, and notes.
- `20260711010000_merge_and_sync_foundation.sql`
  - Adds merge jobs/items, sync change feed, mutation dedupe records, RLS, and
    service-role-only resumable logical-ID backfill.
- `20260711020000_atomic_credit_consumption.sql`
  - Adds atomic managed-AI credit reservation.
- `20260711030000_deletion_lifecycle.sql`
  - Adds delayed, cancelable, audited workspace/account deletion requests.
- `20260711040000_sync_pull_rpc.sql`
  - Adds bounded cursor-based sync pull RPC.

All migrations are additive. Do not add `NOT NULL` or unique logical-ID
constraints until the resumable backfill has run to completion and tenant
collision checks pass.

## Required Implementation Phases

### Phase 1: Schema and Identity Completion

1. Start Docker and run local Supabase.
2. Apply all migrations in order.
3. Run `backfill_logical_ids` in batches until each content table has no null
   `logical_id` values.
4. Verify logical IDs are unique within each workspace and no cross-tenant
   records are visible.
5. Add constraints/indexes only after the backfill report is clean.
6. Add migration/RLS tests for every new table, function, and policy.

### Phase 2: Staged Merge Workflow

1. Implement authenticated server endpoints or RPCs for:
   - stage local export
   - read merge preview
   - set conflict resolutions
   - commit an approved merge
   - rollback a committed merge within its recovery window
2. The server, not the browser preview, is authoritative for decisions.
3. Stage every source row in `merge_job_items`; never mutate cloud content
   during preview.
4. Use stable logical IDs for matching.
5. Put existing-cloud-data imports into a separate `Imported from this device`
   workspace by default unless the user explicitly merges into an existing one.
6. Require explicit confirmation before commit.
7. Make staging and commit idempotent through job/mutation keys.
8. Record every commit/rollback in `audit_logs`.
9. Replace the current disabled signed-in import controls with a merge wizard
   only when this phase is complete.

### Phase 3: Durable Sync

1. Implement server mutation apply API/RPC:
   - workspace membership/edit permission check
   - mutation UUID dedupe through `sync_mutations`
   - expected-version conflict detection
   - server-assigned cursor and time
   - append a `sync_changes` record for each accepted upsert/delete
2. Keep tombstones until all supported clients can safely consume deletion
   cursors; do not hard-delete synced content as the first operation.
3. Implement browser push:
   - read compacted workspace outbox
   - send bounded batches from `sync/protocol.ts`
   - retain failed mutations with retry state
   - remove only server-confirmed mutations
4. Implement browser pull:
   - persist per-workspace cursor locally
   - call `pull_sync_changes`
   - apply changes idempotently
   - preserve unresolved conflicts for user resolution
5. Add offline/reconnect/retry/backoff behavior.
6. Do not label the product as cross-device synced until two-device tests pass.

### Phase 4: Workspace and Account Lifecycle

1. Build the UI and backend for deletion requests using `deletion_requests`.
2. Require explicit confirmation token and a delayed cancellation window.
3. Provide export before destructive execution.
4. Implement ownership transfer and ensure every team workspace retains an
   owner before owner removal/account deletion.
5. Implement account deletion as a job that handles all owned workspaces,
   memberships, Stripe identity linkage, and retention obligations.
6. Keep direct `DELETE FROM workspaces` unavailable from browser adapters.

### Phase 5: Entitlements, Billing, and Managed AI

1. Define server-side entitlement lookup for plan, workspace count, seat count,
   managed AI limits, and grace period.
2. Enforce every hosted limit server-side; browser gates are presentation only.
3. Implement Stripe checkout with idempotency and user/workspace binding.
4. Implement Stripe webhook signature verification, durable event receipt,
   replay protection, ordering tolerance, and reconciliation job.
5. Never trust frontend success redirects as proof of entitlement.
6. Finish provider dispatch and validated response schemas before setting
   `HOSTED_AI_ENABLED=true`.
7. Preserve BYOK as independent from managed AI quotas.
8. Add compensation/refund logic if a provider call fails after a credit is
   reserved, or reserve only at the correct validated dispatch point.

### Phase 6: Validation and Controlled Rollout

1. Run all local migration and RLS integration tests with Docker.
2. Run two-device merge/sync tests:
   - empty cloud + local data
   - existing cloud + local data
   - duplicate retry
   - concurrent update conflict
   - delete/offline/reconnect
   - rollback after partial merge failure
3. Run Stripe lifecycle tests:
   - trial/start
   - checkout retry
   - webhook replay
   - upgrade/downgrade
   - payment failure/grace
   - cancellation
4. Verify export works during billing failure and sync outage.
5. Enable in this order:
   - schema migration
   - logical-ID dual write
   - merge cohort
   - sync cohort
   - lifecycle controls
   - billing enforcement
   - managed AI
6. Every flag requires a rollback condition and operator runbook.

## Do Not Do

- Do not delete or reset IndexedDB to fix migration/sync problems.
- Do not reintroduce `migrateLocalDataToCloud` or automatic cloud import.
- Do not enable a sync label merely because cloud storage is connected.
- Do not enable hosted AI while provider dispatch is a stub.
- Do not expose cloud factory reset or direct workspace deletion.
- Do not apply the new migrations to production without local RLS validation.
- Do not remove local export/import or BYOK to create a plan upsell.

## Important Files

- `apps/web/src/App.tsx`: cloud safety gates and disabled destructive controls.
- `apps/web/src/db/browser-local-adapter.ts`: local data, v2 export, compacted
  workspace outbox.
- `apps/web/src/db/supabase-cloud-adapter.ts`: cloud mapping and direct deletion
  guard.
- `apps/web/src/sync/cloud-migration.ts`: write-free merge preview.
- `apps/web/src/sync/protocol.ts`: typed sync request/pull contracts.
- `supabase/functions/run-ai-action/index.ts`: hosted AI gate and atomic credit
  RPC caller.
- `supabase/functions/deno.json`: Deno dependency configuration.
- `supabase/migrations/`: additive hosted platform migrations listed above.
- `.slim/deepwork/hosted-entitlements-sync-audit.md`: session-level detailed
  research and progress notes. This path is intentionally ignored by git.

## Execution Discipline

- Keep all work uncommitted until requested otherwise.
- Before each phase, inspect current worktree changes and preserve unrelated
  work.
- Use `apply_patch` for source changes.
- Run relevant typechecks/tests after each bounded change.
- Do not mark a phase complete until its required validation passes.
- If Docker is unavailable, continue non-runtime implementation but keep every
  cloud-affecting feature disabled and unreleased.

## Audit Addendum: Required Before Hosted Rollout

The plan was independently audited against the repository. The following items
are mandatory additions, not optional hardening.

### Reorder the Work

Before merge or sync, implement a transactional server-side `create_workspace`
flow. It must enforce entitlement/workspace/seat limits, create the workspace
and exactly one active owner membership atomically, and roll back failed
bootstrap. Browser adapters must no longer create a workspace and owner
membership in separate requests.

Logical-ID order must be:

1. Ship read fallback plus dual-write compatibility.
2. Wait for legacy client write cutoff/adoption.
3. Run resumable backfill and duplicate report.
4. Add unique `(workspace_id, logical_id)` indexes.
5. Add `NOT NULL` constraints.
6. Enable merge/sync cohorts.

Do not add constraints before dual-write adoption; old clients can otherwise
create null logical IDs after backfill. Roll back code/flags, never populated
additive schema migrations.

### Database Invariants and Direct-Write Removal

- Prevent zero active workspace owners and owner/membership mismatch.
- Use an owner-only transactional ownership-transfer RPC; revoke browser-side
  owner/membership mutations that can bypass the invariant.
- Make deletion requests a server-only state machine. Clients must not supply
  status, execution date, confirmation token, or arbitrary request metadata.
- Enforce minimum delay, one active request per scope, confirmation validation,
  immutable request fields, idempotent executor locking, and cancellation.
- Revoke physical `DELETE` on sync-managed content. All deletes become
  versioned soft deletes/tombstones through the apply-mutation API.
- Make `workspace_id`, `created_by`, and `logical_id` immutable after creation.
- Enforce that project, idea, task, and note references stay in the same
  workspace; do not rely on application code for this invariant.
- Migrate all cloud content writes away from direct REST upserts/updates before
  sync activation. The server apply API must validate membership, immutable
  fields, payloads, logical identity, and expected version; dedupe mutations;
  and emit exactly one outcome and change-feed row per accepted mutation.

### Merge Requirements Added by Audit

- Merge physical-ID references through a server-managed logical-to-target-ID
  map. Handle dependency ordering, duplicate resolution, dangling references,
  and rewrites of dependent references.
- Commit atomically or retain per-item preimages/results.
- Rollback only when no later mutation changed a committed item; otherwise make
  it an explicit conflict, never a blind restore.
- Merge commits and rollback effects must enter the sync feed or require a
  defined workspace resnapshot.

### Bounded Sync Recovery

Define and implement:

- cursor retention period and cursor floor;
- paginated authoritative workspace snapshot/bootstrap endpoint;
- expired-cursor resnapshot that preserves unresolved local edits;
- tombstone/change compaction policy;
- local transactional apply: persist records before advancing cursor;
- batch atomicity, retry outcomes, and duplicate response rules.

Indefinite change/tombstone retention "until all clients" is not implementable
for permanently offline devices.

### AI and Entitlement Accounting

- Add an invocation ledger keyed by managed-AI idempotency key with
  `reserved`, `dispatched`, `succeeded`, and `refunded` states.
- Store provider request ID and define timeout/retry/reconciliation behavior.
- Derive quotas from entitlements; do not retain the hard-coded 10-credit
  default as a production policy.
- Use the same transaction/locking standard for workspace-count limits, seats,
  checkout, and invite limits.

### Required Test Expansion

In addition to the original validation matrix, add tests for:

- ownership escalation/removal and zero-owner prevention;
- direct deletion-request state injection denial;
- direct content delete/write denial;
- cross-workspace foreign-key/reference attempts;
- apply-RPC replay, CAS conflict, and concurrent mutations;
- merge relationship remapping and rollback after a later edit;
- cursor expiry, resnapshot, and crash between record apply/cursor advance;
- quota races and managed-AI retry/refund reconciliation;
- RLS for `merge_jobs`, `merge_job_items`, `sync_changes`, `sync_mutations`,
  `deletion_requests`, billing tables, rate-limit tables, and privileged RPCs;
- browser local adapter outbox compaction, v2 export, IndexedDB migration, and
  workspace filtering;
- cloud adapter CRUD behavior, not only unconfigured-client failure;
- Stripe cross-repository contract/smoke tests against `opennapse-billing`.

### Operations Gaps

- Add a local Supabase CLI/Docker stack; the existing `docker-compose.yml` only
  runs the web frontend.
- Create an operator runbook with explicit enablement order, metrics, abort
  conditions, rollback action, and owner for every feature cohort.
- Add a post-backfill migration template for logical-ID indexes/constraints;
  apply it only after the backfill report is clean.
- Remove or implement the unsupported `links` outbox entity; no links table
  currently exists.
- Make workspace invite limits configurable rather than retaining a hard-coded
  20 invites/24 hours for every hosted plan.
