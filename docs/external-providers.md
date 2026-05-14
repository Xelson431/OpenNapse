# External Provider Prerequisites

The local app is operational without external services. These provider-backed features remain gated until their security prerequisites are satisfied.

## Cloud Sync

- Supabase URL and anon key configured by environment.
- RLS enabled on every table.
- Cross-user access tests passing.
- Per-table sync handlers or strict table/column allowlists.
- Conflict recovery UI and sync diagnostics verified.

## Self-hosting

- Strong secrets in `.env`, never committed.
- HTTPS in production.
- Backup/restore tested.
- Migration rollback documented.

## Hosted AI

- Explicit opt-in.
- Clear preview of data sent to provider.
- Zod validation of all responses.
- Local Ollama/rules provider remains the preferred privacy-preserving default.
