# Teams & Collaboration

How OpenNapse supports multi-user, multi-team, multi-workspace collaboration —
and the checklist of what must hold for it to work flawlessly.

## Model

- **Workspace** — a container of ideas/projects/tasks/notes. Has one owner and
  direct `workspace_members`.
- **Team** — an account-level group of users (owner + members). A user can own
  and belong to **many** teams.
- **team_workspaces** — a many-to-many link. A team can be attached to **many**
  workspaces; a workspace can have **many** teams attached.

Attaching a team to a workspace grants its active members access to that
workspace's content, *in addition to* direct `workspace_members`. This is the
mechanism behind the product-owner scenario:

> As a product owner I create Team A and attach it to Workspace 1, then create
> Team B with different members and attach it to Workspace 2.

Both are independent teams with independent membership, each scoped to the
workspace(s) they're attached to.

## Access resolution (server truth)

`is_workspace_member()` / `can_edit_workspace()` (in `20260714010000_teams.sql`)
return true if the caller is EITHER:
1. an active `workspace_members` row, OR
2. an active member of a team attached to that workspace via `team_workspaces`.

Both are `SECURITY DEFINER` so team lookups don't recurse through RLS. All
content RLS (ideas/projects/tasks/notes) already routes through these helpers,
so team access flows everywhere automatically.

## Gating (self-host vs hosted)

Teams key off **capability + entitlement**, never "is this the hosted product":
- **Local-only** (no Supabase): no teams — there's no backend to share through.
- **Self-hosted + Supabase + signed in**: teams work (generous entitlement).
- **Hosted Pro**: teams work (`max_seats` > 1).
- **Hosted Free**: gated, with an upgrade hint.

The UI reads `useEntitlements()` → `entitlement_limits` RPC. See
[feature-matrix.md](./feature-matrix.md).

## Task attribution

Every task records:
- `created_by` — who created it (existing).
- `updated_by` — who last changed it (stamped on every move/update).
- `assignee_id` — who owns the work (nullable; must be an active workspace
  member, enforced by trigger).

## Migrations

- `20260714000000_task_attribution.sql` — task `updated_by`, `assignee_id`,
  assignee-membership trigger.
- `20260714010000_teams.sql` — teams, team_members, team_workspaces, RLS,
  membership helpers, extended workspace-access helpers, and the write RPCs
  (`create_team`, `add_team_member`, `remove_team_member`,
  `attach_team_to_workspace`, `detach_team_from_workspace`).

All additive. With no team rows, access behaves exactly as before.

## Full-circuit audit — checklist

Legend: ✅ done · ⏳ backend done, UI pending · ☐ todo

### Identity & attribution
- ✅ Task `created_by`
- ✅ Task `updated_by` (stamped on move/update in both adapters)
- ✅ Task `assignee_id` (+ membership trigger)
- ☐ Surface created/updated/assignee in the task UI
- ☐ Assignee picker (choose from workspace members) in task detail
- ☐ Idea/project/note attribution display (data exists via `created_by`)

### Teams
- ✅ Create multiple teams (`create_team`)
- ✅ Add/remove team members with roles (`add/remove_team_member`)
- ✅ Attach/detach a team to/from many workspaces (`attach/detach_team_to_workspace`)
- ✅ Team access extends content RLS (member of attached team can read/edit)
- ✅ Client service (`auth/team-management.ts`)
- ⏳ Team management UI (create team, manage members, attach to workspaces)
- ☐ Team invite-by-email flow (reuse workspace invite pattern for team scope)
- ☐ Team ownership transfer RPC + UI

### Workspace membership (existing, verified)
- ✅ Invite / accept / revoke / remove member
- ✅ Roles (owner/admin/member/viewer) enforced in RLS + RPCs
- ✅ Ownership transfer (blocked while deletion pending)
- ✅ Single-active-owner invariant

### Collaboration correctness (still to validate)
- ☐ Concurrent edit conflict handling (needs the sync engine — staged, off)
- ☐ Presence / "who's viewing" (not started; optional)
- ☐ Realtime updates (Supabase Realtime subscription; not wired)
- ☐ Per-member activity feed from `audit_logs` (data exists; no UI)

### Security / RLS to test before enabling at scale
- ☐ Team member of Team A attached to WS1 CANNOT read WS2 (only Team B's)
- ☐ Non-admin cannot add/remove team members or attach teams
- ☐ Only workspace owner/admin can attach a team to their workspace
- ☐ Removing a team from a workspace revokes access immediately
- ☐ Assignee must be an active member (trigger) — attempt cross-workspace assign
- ☐ `team_members` / `team_workspaces` / `teams` RLS: no cross-team leakage

## What's intentionally NOT here (hosted-exclusive)

Per the [global rule](../AGENTS.md), anything commercial lives in the private
`opennapse-billing` wrapper: paid seat limits, team-count pricing, managed AI
quotas. The public repo ships generous self-host defaults; the wrapper overrides
`entitlement_limits` for the hosted tiers. Team *functionality* is in this repo
(self-hosters get it); team *pricing* is not.

## Next implementation steps (recommended order)

1. Team management UI: create team, member list + add/remove, attach to
   workspaces (wire `auth/team-management.ts`).
2. Task detail: show created/updated/assignee; add an assignee picker.
3. Team invite-by-email (extend invite Edge Function with a team scope).
4. RLS integration tests for the cross-team isolation cases above.
5. Realtime + presence (after the sync engine lands).
