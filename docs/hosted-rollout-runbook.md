# Hosted rollout runbook

All hosted features default off. Never apply this sequence without a database backup and a tested restore.

## Preconditions

- Docker and Supabase CLI available; `supabase start` is healthy.
- Full web tests, migration reset, RLS integration tests, and Edge Function checks pass.
- Production backup restored into a disposable project and verified.
- Named operator and rollback owner are online for each cohort.

## Enablement order

| Cohort | Enable only after | Watch | Abort when | Rollback |
|---|---|---|---|---|
| Additive schema | Local reset + RLS pass | migration duration/errors | lock or migration error | stop rollout; restore only if migration transaction failed destructively |
| Logical-ID dual write | old-client cutoff agreed | null-ID write rate | any new null logical ID | roll back client flag, keep additive columns |
| Backfill | duplicate report clean | remaining nulls, locks | tenant collision or elevated latency | stop batch; do not remove populated columns |
| Merge | relationship/rollback tests pass | failed jobs/conflicts | partial commit, reference error | disable merge flag; use guarded rollback RPC |
| Sync | two-device and resnapshot tests pass | rejected mutations, cursor lag | data loss, cursor regression, conflict spike | disable sync workers; preserve outboxes and cursors |
| Lifecycle | ownership/deletion tests pass | pending/executing jobs | zero-owner or premature execution | disable lifecycle executor; cancel pending jobs |
| Billing | wrapper contract tests pass | webhook lag/replay, entitlement mismatch | export blocked or wrong entitlement | disable enforcement; retain subscription records |
| Managed AI | dispatch + ledger reconciliation pass | reservation age, refunds, provider errors | unrefunded charge or invalid output | disable both AI flags; reconcile ledger |

## Required rehearsals

1. Empty cloud + local merge; existing cloud + local merge; conflicts; duplicate retry; rollback after commit and refusal after later edit.
2. Two devices: offline edits, reconnect, concurrent CAS conflict, delete tombstone, expired cursor, resnapshot while preserving local outbox.
3. Ownership transfer, owner removal refusal, seat race, deletion request injection refusal, cancellation, delayed executor idempotency.
4. Checkout retry, webhook replay/out-of-order delivery, upgrade/downgrade, past-due grace, cancellation, export during outage.
5. Managed-AI reservation, dispatch timeout, retry with same key, success, failure refund, reconciliation.

## Never do

- Never clear IndexedDB or discard an outbox as recovery.
- Never run replacement import against a cloud workspace.
- Never enable `HOSTED_AI_ENABLED` or `HOSTED_AI_DISPATCH_READY` while dispatch remains unvalidated.
- Never apply [post-backfill-logical-id.sql](../supabase/templates/post-backfill-logical-id.sql) before the adoption and collision gates pass.
