# Feature & Plan Matrix

A checklist of capabilities and how they resolve across the three ways OpenNapse
runs. Use it to verify a change didn't break one audience while fixing another.

## The three audiences

| Audience | Backend | How limits resolve |
| --- | --- | --- |
| **Self-hosted / local** | IndexedDB, or own Supabase | `entitlement_limits()` (public) returns generous self-host defaults — no paid tiers, teams work |
| **Hosted Free** | OpenNapse Supabase | Private `entitlement_limits()` → 1 workspace / 1 seat — teams gated |
| **Hosted Pro** | OpenNapse Supabase + billing | Private `entitlement_limits()` → 20 workspaces / 100 seats — teams enabled |

## How gating works (single source of truth)

The UI gates paid capabilities on `useEntitlements()` (`apps/web/src/auth/entitlements.ts`),
which calls the `entitlement_limits` RPC. That RPC is:

- **Public repo**: plan-agnostic, generous (self-host).
- **Private billing repo**: status-gated Pro tiers (hosted).

`teamWorkspacesEnabled = VITE_ENABLE_TEAM_WORKSPACES || entitlements.teamsAllowed`.
`teamsAllowed` is true when `max_seats > 1` or `max_workspaces > 1`.

> This means self-host and Pro both get teams automatically; hosted Free is
> gated until upgrade. No build flag is required for Pro to work.

## Capability checklist

Legend: ✅ works · 🔒 gated (needs Pro/entitlement) · — n/a

| Capability | Self-host | Hosted Free | Hosted Pro | Notes |
| --- | --- | --- | --- | --- |
| Capture / ideas / kanban / notes / graph / focus / stats | ✅ | ✅ | ✅ | Core, always local-first |
| Idea descriptions + resources | ✅ | ✅ | ✅ | Local or cloud adapter |
| Export / import JSON | ✅ | ✅ | ✅ | Never removed for a plan |
| BYOK AI providers | ✅ | ✅ | ✅ | Keys session-only |
| Personal workspace | ✅ | ✅ | ✅ | |
| Multiple workspaces | ✅ | 🔒 (1) | ✅ (20) | `max_workspaces` |
| **Team workspaces** | ✅ | 🔒 | ✅ | `teamsAllowed` |
| Invite members / roles | ✅ | 🔒 | ✅ | `max_seats`, `max_pending_invites` |
| Transfer ownership | ✅ | 🔒 | ✅ | Owner-only RPC |
| Workspace deletion lifecycle | ✅ (immediate local) | ✅ (30d cloud) | ✅ (30d cloud) | Local deletes now; cloud delayed |
| MCP agent access | ✅ (own Supabase) | ✅ | ✅ | Needs Supabase + sign-in |
| Managed AI credits | — | 🔒 (low) | 🔒 (higher) | Gated until dispatch ready |
| Billing / upgrade UI | hidden | ✅ | ✅ | Only when `VITE_BILLING_URL` set |

## Verification steps

### For hosted Pro
1. Sign in with a Pro account.
2. Settings → Data: the **Team** toggle is enabled (not grayed); shows "Team mode is enabled".
3. Toolbar workspace selector → **＋ Create workspace** offers the **Team** type.
4. Create a team workspace → invite a member (Settings → Advanced/Team) → accept → transfer ownership → remove.
5. Create a second workspace (entitlement allows up to 20).

### For hosted Free
1. Team toggle shows "Team · Pro" and is disabled with an upgrade hint.
2. Billing tab offers upgrade.
3. Cannot create a second workspace beyond the personal one.

### For self-host (own Supabase, no billing URL)
1. No Billing tab, no "Pro" copy anywhere.
2. Team toggle is enabled once signed in (generous entitlement).
3. Can create team + additional workspaces freely.

### For local-only (no Supabase)
1. Everything works offline; no auth, no teams, no billing surface.
2. Workspace management: rename/delete work immediately.

## Regression guardrails

- Never gate a **core** feature (capture, export, BYOK) behind a plan.
- Never render "Pro"/billing copy when `VITE_BILLING_URL` is unset.
- Team gating must read `entitlements`, never a hardcoded `disabled`.
- Server enforces the same limits — the UI gate is presentation only.
