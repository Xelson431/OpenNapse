# Supabase migrations

Cloud schema is intentionally kept separate from the local browser schema. Before enabling sync, add PostgreSQL migrations here with:

- RLS enabled on every user-owned table.
- `user_id = auth.uid()` ownership policies.
- Whitelisted sync handlers, not arbitrary dynamic table writes.
- Tombstones/soft deletes for synced records.

Cloud sync remains **Coming soon** until these security guarantees are implemented and tested.
