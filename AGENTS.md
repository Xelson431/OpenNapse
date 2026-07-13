# OpenNapse — AI agent guide

Local-first idea-to-project workspace. Everything stays in your browser by default.

## Style
- Terse. Bullets > prose. No praise. No long summaries unless asked.

## Safety
- Never commit secrets, API keys, or tokens.
- Provider API keys are session-only (never persisted).

## GLOBAL RULE: self-host vs hosted (repo separation)
- This public repo (MIT) is shared by BOTH the self-hosted and hosted products.
  Everything here must work for a self-hoster with NOTHING but their own
  Supabase (or fully local). Never assume OpenNapse's hosted infra.
- Anything EXCLUSIVE to the hosted product (Stripe billing, paid-plan pricing,
  paid-tier entitlement numbers, managed-AI quotas, commercial plan catalog)
  lives ONLY in the private `opennapse-billing` wrapper repo — never in this repo.
- Gating must read server truth (`entitlement_limits` RPC), not hardcoded plan
  logic. The public `entitlement_limits` is plan-agnostic/generous (self-host);
  the private wrapper overrides it with paid tiers for the hosted deployment.
- UI must render ZERO "Pro"/billing/upgrade surface when `VITE_BILLING_URL` is
  unset (self-host builds see no commercial hints).
- Feature capabilities (e.g. teams) key off dependencies present (Supabase
  linked) or entitlements — never off "is this the hosted product".
- See docs/feature-matrix.md before changing any gated capability.

## Product
- Views: Capture, Dashboard, Kanban, Notes, Graph, Focus, Stats.
- Capture: dump ideas; promote to project with why-now + first-step + done-looks-like.
- Dashboard: folder grid; project-scoped context.
- Kanban: native HTML5 drag/drop + keyboard movement.
- Notes: local markdown with optional voice memos.
- Graph: entity map with node selection.
- Focus: single-item mode for deep work.
- Stats: export/import JSON, factory reset, load demo data.
- Sidebar: project/tag filters, search.
- Command palette: ⌘K navigation + creation shortcuts.
- Settings: theme, account (auth), AI providers, data management.
- Supports Supabase auth and cloud sync when configured (optional).
