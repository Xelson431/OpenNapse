# Security Baseline

OpenNapse contains private thoughts, notes, plans, and project data. The default posture is local-first and private.

## Non-negotiables

- No telemetry by default.
- AI disabled by default.
- Cloud sync disabled by default.
- No service-role or provider secrets in frontend code.
- Imported data and AI output are untrusted until validated.
- Notes/content must be rendered safely; no raw HTML injection.

## Current implementation

- Local persistence is browser-local and isolated behind an adapter.
- Domain writes are validated with Zod.
- Deferred cloud/AI/self-hosting features are flagged as coming soon.

## Before cloud sync

- Add Supabase RLS tests proving user A cannot access user B data.
- Avoid generic dynamic `SECURITY DEFINER` sync RPCs.
- Whitelist sync tables and columns.
- Make conflicts visible and recoverable.

## Before AI providers

- Add explicit opt-in.
- Show what context will be sent.
- Prefer local Ollama/embedding providers.
- Validate every AI response with Zod before showing or saving.
