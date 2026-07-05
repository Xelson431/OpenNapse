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

## Current defenses (shipped)

**Content-Security-Policy**
Docker nginx serves both an enforced CSP and a Report-Only mirror. The enforced policy restricts script sources to `'self'` only (no inline scripts from production builds), `connect-src` to self, Supabase, and known AI providers (not wildcard `https:`). Report-Only violations POST to `/csp-report` for monitoring. CSP is absent from the Vite dev server — violations found there won't surface until running behind nginx.

**Markdown link sanitization**
`renderMarkdown()` applies `sanitizeMarkdownHref()` to every rendered anchor, rewriting `javascript:`, `data:`, `vbscript:`, `file:`, and control/whitespace-obfuscated variants to `#`. This supplements the HTML-level `escapeHtml()` protection.

**Voice recording dataUrl cap**
`voiceRecordingSchema.dataUrl` is capped at 10MB (`MAX_VOICE_RECORDING_DATA_URL_LENGTH`). The NoteEditor discards oversized recordings before they enter React state, preventing IndexedDB quota exhaustion via large base64 payloads.

**IndexedDB write error handling**
`IndexedDBBackend.write()` wraps the `idb` put in try/catch, logging failures with `console.warn` and rethrowing so callers can surface user-facing feedback.

**javascript: / data: / file: URLs blocked in markdown links**
`renderMarkdown` rewrites dangerous URL schemes to `#` via `sanitizeMarkdownHref()`. Tested against 6+ bypass variants including newline obfuscation.

**Hosted write rate limits**
Supabase hosted deployments can apply `20260706000000_hosted_rate_limits.sql`, which adds trigger-level rate limits to `projects`, `ideas`, `tasks`, and `notes`. Client-side throttles improve UX, but database triggers are the hosted security boundary for direct Supabase REST writes.

**Billing boundary**
The public app contains generic, inert billing UI gated by `VITE_BILLING_URL`; Stripe checkout, portal, webhook handling, and secrets belong in a private billing wrapper. See `docs/hosted-billing-wrapper.md`.
