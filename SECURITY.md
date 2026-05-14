# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest `main` | ✅ |
| older commits | ❌ |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please report them responsibly:

1. Email **security@opennapse.dev** (or DM the maintainer on GitHub if no email is configured yet).
2. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if you have one)
3. You'll receive an acknowledgment within 48 hours.
4. We'll work with you to understand and fix the issue before any public disclosure.

## Security Design Principles

This project follows these security principles by design:

- **No secrets in the client bundle** — API keys are session-only (in memory), never persisted to localStorage, sessionStorage, or IndexedDB.
- **BYOK keys stored server-side only** — Supabase Vault holds encrypted provider keys; Edge Functions resolve them at call time.
- **Row-Level Security** — all cloud tables enforce workspace-scoped access via Postgres RLS policies.
- **Deny by default** — RLS policies start from deny; access is explicitly granted per role.
- **No telemetry** — the app sends zero analytics or tracking data unless the user explicitly opts into cloud features.
- **Zod validation at boundaries** — all data entering or leaving the persistence layer is schema-validated.

## Scope

The following are in scope for security reports:

- Authentication bypass
- Authorization flaws (accessing another user's workspace data)
- API key exposure in client bundle, logs, or storage
- XSS, CSRF, or injection vulnerabilities
- RLS policy bypass
- Edge Function privilege escalation

## Out of Scope

- Denial of service against the user's own local browser storage
- Social engineering
- Vulnerabilities in dependencies (report those upstream; we'll update promptly)

## Recognition

We're happy to credit security researchers in our CHANGELOG and README (with your permission).
