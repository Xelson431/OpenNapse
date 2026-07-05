# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Multi-workspace support (personal + team workspaces)
- 8 AI providers: OpenAI, Anthropic, OpenRouter, Mistral, DeepSeek, Groq, Ollama Cloud, local rules
- Editable base URLs for OpenAI and Anthropic (use your own compatible endpoint)
- IndexedDB storage backend (replaces localStorage for durability)
- Auto-migration from localStorage to IndexedDB on first load
- Sign-in modal with magic link authentication
- Team settings panel (invite members, manage roles, revoke invites)
- Credits & usage dashboard (daily balance, recent AI activity)
- Audit log panel for team workspaces
- Workspace creation modal (personal or team)
- First-run tutorial overlay (4 steps, skippable, persists dismissal)
- "All" button in sidebar for discoverable filter reset
- Supabase Cloud Adapter (full CRUD against workspace-scoped tables)
- SQL migrations for content tables with Row-Level Security
- SQL migrations for ops tables (invites, AI usage, credits, audit logs, provider configs)
- Edge Functions: bootstrap-personal-workspace, invite-member, accept-invite, test-provider-connection, run-ai-action
- URL-based invite token redemption (?invite=token)
- Graph view: nebula background, smooth bezier curves, polar auto-organize with collision relaxation
- Graph view: animated relayout with flash effect
- Sidebar: responsive mobile overlay with click-outside dismiss, Escape close, focus management
- Sidebar: matchMedia subscription for viewport-aware collapse
- Sidebar: desktop preference persistence
- Notes view: aligned header heights between sidebar and editor toolbar
- Electron build pipeline with proper TypeScript compilation
- PWA manifest with favicon icon entry
- Icon component extracted to src/components/Icon.tsx
- Drag helpers extracted to src/lib/drag.ts
- StorageBackend abstraction (IndexedDB primary, localStorage fallback for tests)
- .env.example for Supabase configuration
- Docker compose scaffold for self-hosting
- Full open-source community files (LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CHANGELOG)
- GitHub issue templates (bug report, feature request)
- GitHub pull request template
- .editorconfig + .nvmrc
- Real BYOK connection test: browser-direct fetch to provider chat endpoints with minimal payload, CORS error handling, and clear pass/fail badges
- Live model listing from provider APIs (GET /v1/models) after successful connection test, with graceful fallback to curated list when CORS-blocked
- Key visibility toggle (Show/Hide) on AI API key input field
- Public documentation under docs/: getting-started, project-structure, views, data-layer, architecture, ai, supabase, testing, troubleshooting
- Full architecture reference in docs/architecture.md with seams table, adapter diagram, three deployment shapes, and state-vs-staged capability table
- .dockerignore for Docker self-host scaffold
- Kanban lightweight scheduling (optional `scheduledDate`/`dueDate` on tasks, today/overdue strip, date pills on task cards)
- Focus Sprint: Pomodoro-style timer linked to a Kanban task or idea (work/deep/break presets, start/pause/reset, completion tracking)
- Edge case and security challenge test suite (41 tests across 10 categories: XSS resistance, domain boundaries, unicode, prototype pollution, workspace isolation, AI key rejection, rate limiting audit, malformed input)
- Additive migration `20260704000000_task_calendar_fields.sql` for task date columns + filtered indexes
- Runtime DB adapter registry for switching between local IndexedDB and Supabase cloud storage after sign-in/bootstrap
- Env-gated Supabase RLS integration test suite (`SUPABASE_TEST_*`) covering cross-user isolation, viewer write blocking, and removed-member access loss
- Hosted write rate-limit migration (`rate_limit_events` + triggers) for server-side protection on direct Supabase table writes
- Generic hosted billing/entitlement schema plus private billing-wrapper contract documentation
- Billing wrapper client/UI gated by `VITE_BILLING_URL` (no Stripe SDK or secrets in the public app)
- First sign-in local-to-cloud migration prompt when cloud workspace is empty and local data exists

### Changed
- Domain models now require `workspaceId` + `createdBy` on all content records
- BrowserLocalAdapter uses pluggable StorageBackend instead of direct localStorage calls
- AI settings schema expanded to hold per-provider config (model, baseUrl, consent)
- Sidebar filter no longer forces view changes (removed view-switching side effect)
- Sidebar tree uses proper ARIA (aria-level, aria-expanded, aria-selected)
- Sidebar "Projects" is a passive section header, not a clickable filter
- Workspace toolbar uses native select dropdown instead of chip buttons
- handleSidebarFilter implements toggle behavior (click same project = deselect)
- Removed duplicate bun.lock (pnpm is the canonical package manager)
- Updated dummy-data.json with workspaceId + createdBy fields
- .gitignore extended for public repo hygiene: ignore opencode.json, .opencode/, .supraspace/, package-lock.json, yarn.lock
- AGENTS.md updated with public repo safety rules (never `git add .`, reject stray lockfiles, stop+rotate if secrets tracked)
- README repositioned from "local-first" to hybrid "runs anywhere" (browser/Docker/Supabase); workflow-focused features; honest cloud sync status
- AI settings panel consolidated: key input, base URL, test button, model selector, and consent checkbox in one section; removed fake "test connection gate"
- Supabase migration cleaned up: removed duplicated DDL statements, fixed truncated foreign key reference
- accept-invite edge function email guard flipped: `if (user.email && ...)` → `if (!user.email || ...)`
- Docker nginx CSP from report-only to enforced + Report-Only mirror; restricted `script-src 'self'` and `connect-src` to known AI providers instead of wildcard `https:`
- Content-Security-Policy-Report-Only replaced with dual enforced CSP + Report-Only in nginx
- Team workspaces disabled locally (`ENABLE_TEAM_WORKSPACES = false`); hidden from switcher, team creation blocked, Team Settings explains hosted-only future scope
- Supabase content migration updated: tasks table now includes `scheduled_date` and `due_date` columns with filtered indexes
- `taskSchema` domain model extended with nullable `scheduledDate` and `dueDate` date-only fields
- `CreateTaskInput` interface extended with optional `scheduledDate` and `dueDate`
- `SupabaseCloudAdapter.updateTask()` now increments task versions like the local adapter
- Zustand stores now resolve the active DB adapter at call time instead of importing the local adapter directly
- Client-side write operations now pass through an in-memory rate limiter for accidental-spam protection
- Voice recording dataUrl capped at 10MB in Zod schema (was unbounded)
- FocusView now accepts ideas list and includes Focus Sprint panel; supersedes generic "daily focus slots" surface
- Kanban quick-add form includes optional Plan/Due date inputs
- SupabaseCloudAdapter row mapper updated for new task date columns
- Mentor test fixtures updated with `scheduledDate: null, dueDate: null`

### Fixed
- Electron main entrypoint now compiles TypeScript to dist-electron/ (was shipping raw .ts)
- Electron preload script re-extension to .cts and new tsconfig.electron-preload.json for proper TypeScript compilation
- Zod parse failures in BrowserLocalAdapter now log warnings instead of silently dropping records
- Service worker manifest.webmanifest now includes favicon icon (was empty array)
- Notes sidebar header and editor toolbar now share the same height
- renderMarkdown XSS (C1): HTML escaping (`escapeHtml`) applied before markdown regex substitution — prevents stored XSS via note content
- Notes duplication on second save (C3): upsertNote returns note id; NotesView captures it to update activeId instead of discarding
- Voice recorder MediaRecorder leak (C4): streamRef captures MediaStream; useEffect cleanup stops tracks on NoteEditor unmount
- Corrupted Supabase migration (C2): truncated FK reference repaired, duplicated DDL body removed
- accept-invite edge function email bypass (H1): guard now rejects email-less auth users instead of silently passing them through
- workspace_members missing UPDATE/DELETE RLS (H2): owners and admins can update/remove members; active members can leave their workspace
- importData and Load Demo Data silent overwrite (M1): window.confirm() dialogs warn before replacing all data
- Markdown link scheme bypass (B1): `sanitizeMarkdownHref()` blocks `javascript:`, `data:`, `vbscript:`, `file:`, and control/whitespace-obfuscated URLs — rewrites to `#`
- CSP was report-only and too broad (B2): now enforced with `script-src 'self'` and scoped `connect-src` to known AI providers, plus Report-Only mirror for monitoring
- Voice recording async setState after unmount (B3): `mountedRef` guard + oversized dataUrl discard before React state
- Hosted AI workspace/config binding (B4): `run-ai-action` rejects workspace-scoped provider configs where `workspaceId` doesn't match the requested workspace
- Electron main entrypoint now compiles TypeScript to dist-electron/ (was shipping raw .ts)
- Zod parse failures in BrowserLocalAdapter now log warnings instead of silently dropping records
- Service worker manifest.webmanifest now includes favicon icon (was empty array)
- Notes sidebar header and editor toolbar now share the same height
- renderMarkdown XSS (C1): HTML escaping (`escapeHtml`) applied before markdown regex substitution — prevents stored XSS via note content
- Notes duplication on second save (C3): upsertNote returns note id; NotesView captures it to update activeId instead of discarding
- Voice recorder MediaRecorder leak (C4): streamRef captures MediaStream; useEffect cleanup stops tracks on NoteEditor unmount
- Corrupted Supabase migration (C2): truncated FK reference repaired, duplicated DDL body removed
- accept-invite edge function email bypass (H1): guard now rejects email-less auth users instead of silently passing them through
- workspace_members missing UPDATE/DELETE RLS (H2): owners and admins can update/remove members; active members can leave their workspace
- importData and Load Demo Data silent overwrite (M1): window.confirm() dialogs warn before replacing all data

### Security
- Session API keys never persist to any storage (enforced by tests)
- BYOK keys stored in Supabase Vault only (vault_secret_id reference in ai_provider_configs)
- RLS policies enforce workspace membership on all content tables
- Edge Functions use service-role key server-side only; never exposed to frontend
- XSS vulnerability fixed in note preview renderer (dangerouslySetInnerHTML with unescaped markdown)
- Auth bypass fixed in accept-invite edge function (email-less users could accept any invite)
- CSP enforced in Docker nginx: `script-src 'self'`, scoped `connect-src` to self + Supabase + known AI providers; CSP-Report-Only mirror collects violations at /csp-report
- Markdown link URL scheme sanitization: `javascript:`, `data:`, `vbscript:`, `file:` URLs rewritten to `#` in rendered note links
- Voice recording dataUrl capped at 10MB to prevent IndexedDB quota exhaustion
- IndexedDB write failures now caught and logged (was unhandled throw)
- Hosted AI workspace binding enforced: `run-ai-action` rejects mismatched workspace-scoped provider configs
- 41 edge case / security challenge tests added (93 total): XSS resistance, prototype pollution, workspace isolation, AI key rejection, malformed input, rate limiting audit

## [0.1.0] - 2026-05-08

### Added
- Initial local-first app with 7 views (Capture, Dashboard, Kanban, Notes, Graph, Focus, Stats)
- React 19 + Vite + TypeScript + Zustand + Zod stack
- BrowserLocalAdapter with localStorage persistence
- Idea capture, promotion, bury/resurrect flow
- Project creation with Why Now / First Step / Done Looks Like
- Kanban with native HTML5 drag-and-drop + keyboard movement
- Notes editor with voice memo recording
- Graph view with accessible list fallback
- Focus view with daily slots
- Stats with momentum score and export/import
- Dark/light theme with persistence
- Command palette (Ctrl+K)
- PWA service worker
- Vitest + Testing Library unit tests
- Playwright E2E tests
