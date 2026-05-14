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

### Fixed
- Electron main entrypoint now compiles TypeScript to dist-electron/ (was shipping raw .ts)
- Zod parse failures in BrowserLocalAdapter now log warnings instead of silently dropping records
- Service worker manifest.webmanifest now includes favicon icon (was empty array)
- Notes sidebar header and editor toolbar now share the same height

### Security
- Session API keys never persist to any storage (enforced by tests)
- BYOK keys stored in Supabase Vault only (vault_secret_id reference in ai_provider_configs)
- RLS policies enforce workspace membership on all content tables
- Edge Functions use service-role key server-side only; never exposed to frontend

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
