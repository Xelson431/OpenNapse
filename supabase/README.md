# Supabase cloud foundation

This folder holds cloud/team scaffolding. The web app stays local-first until
the frontend wires the cloud adapter to real workspaces.

## Migration order

1. `20260509000000_workspace_foundation.sql` — `profiles`, `workspaces`, `workspace_members` with RLS.
2. `20260512000000_content_tables.sql` — `ideas`, `projects`, `tasks`, `notes` with workspace-scoped RLS + updated_at triggers.
3. `20260512000100_ops_tables.sql` — `workspace_invites`, `ai_provider_configs`, `ai_usage_events`, `daily_credit_balances`, `audit_logs`.
4. `20260711000000` through `20260711040000` — logical identity, merge/sync tables, atomic credits, deletion staging, and pull RPC.
5. `20260711050000_workspace_and_lifecycle_contracts.sql` — transactional workspace creation, ownership transfer, entitlements, and deletion request RPCs.
6. `20260711060000_sync_apply_and_invariants.sql` — immutable tenant identity, same-workspace references, idempotent CAS mutation apply.
7. `20260711070000_staged_merge_contracts.sql` — authoritative stage/resolve/commit/guarded rollback workflow.
8. `20260711080000_sync_recovery_contracts.sql` — cursor floor and paginated authoritative snapshots.
9. `20260711090000_managed_ai_ledger.sql` — reservation/dispatch/success/refund accounting ledger.
10. `20260711100000_membership_contracts.sql` — owner-safe member removal and seat-limited invite acceptance.

Apply with the Supabase CLI:

```bash
supabase db push
```

## Edge Functions

- `bootstrap-personal-workspace` — on first login, upserts `profiles`, ensures one personal workspace, owner membership.
- `invite-member` — create `workspace_invites` row (owners/admins only), returns token.
- `accept-invite` — redeem a token, add the caller to `workspace_members`.
- `test-provider-connection` — verify a BYOK config by making a single request to the provider; key is pulled from Supabase Vault and never returned.
- `run-ai-action` — single gateway for all hosted AI calls. Enforces workspace access, daily credit limits (non-BYOK), and writes `ai_usage_events`. Provider dispatch currently a stub.

Deploy:

```bash
supabase functions deploy bootstrap-personal-workspace
supabase functions deploy invite-member
supabase functions deploy accept-invite
supabase functions deploy test-provider-connection
supabase functions deploy run-ai-action
```

## Safety notes

- `SUPABASE_SERVICE_ROLE_KEY` stays in Supabase env only. Never commit or expose to the frontend.
- BYOK provider keys live in Supabase Vault; `ai_provider_configs.vault_secret_id` references the vault entry.
- `ai_usage_events` and `daily_credit_balances` are written by Edge Functions with service-role — no user-facing insert policies.
- Content tables never return rows from workspaces the caller isn't an active member of (RLS enforced).
- Hosted feature flags stay off until local migration/RLS tests and the rehearsals in [`docs/hosted-rollout-runbook.md`](../docs/hosted-rollout-runbook.md) pass.
- `templates/post-backfill-logical-id.sql` is a manual post-adoption template, not an automatic migration.
