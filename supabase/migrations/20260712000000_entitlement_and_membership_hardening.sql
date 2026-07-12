-- Hardening for entitlement resolution and membership mutation surface.
-- Additive/forward-only: replaces functions and revokes an over-broad policy.
--
-- Separation note: this PUBLIC migration keeps entitlement resolution
-- plan-agnostic. Self-hosted deployments have no billing, so limits are
-- generous and carry no notion of paid tiers. The hosted product overrides
-- entitlement_limits() from the private billing repo to enforce paid limits.
--
-- Addresses:
--   1. entitlement_limits leaked another workspace's row to any authenticated
--      caller (SECURITY DEFINER, granted broadly, no authorization).
--   2. A browser-facing UPDATE policy on workspace_members let any admin change
--      any member's role/status directly, bypassing the hierarchy, owner
--      protection, and audit logging enforced by the RPCs.
--   3. accept_workspace_invite falsely failed at seat capacity for an existing
--      active member and silently overwrote member roles.

-- -------------------------------------------------------------------------
-- 1. Authorized, plan-agnostic entitlement resolution (self-host defaults).
--    Signature is stable so the hosted product can override the body.
-- -------------------------------------------------------------------------
create or replace function public.entitlement_limits(target_workspace_id uuid default null)
returns table (
  plan_id text,
  max_workspaces integer,
  max_seats integer,
  daily_managed_ai_credits integer,
  max_pending_invites integer,
  grace_until timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- A specific workspace's entitlement is only visible to its active members
  -- or to server-side (service_role) callers. A null target is the generic
  -- self-host allowance and needs no authorization.
  if target_workspace_id is not null
     and auth.role() <> 'service_role'
     and not exists (
       select 1 from public.workspace_members member
       where member.workspace_id = target_workspace_id
         and member.user_id = auth.uid()
         and member.status = 'active'
     ) then
    raise exception 'not authorized to read workspace entitlements' using errcode = '42501';
  end if;

  -- Self-hosted defaults: no billing, no tiers. Generous ceilings that never
  -- get in the operator's way. The hosted deployment replaces this function.
  return query select
    'self-hosted'::text,
    1000000,   -- max_workspaces
    1000000,   -- max_seats
    1000000,   -- daily_managed_ai_credits
    1000000,   -- max_pending_invites
    null::timestamptz;
end;
$$;

revoke all on function public.entitlement_limits(uuid) from public;
grant execute on function public.entitlement_limits(uuid) to authenticated, service_role;

-- -------------------------------------------------------------------------
-- 2. Remove direct browser member mutation. All role/status changes must go
--    through remove_workspace_member / transfer_workspace_ownership /
--    accept_workspace_invite, which enforce hierarchy, owner safety, and
--    audit logging. Self-leave stays available via the existing DELETE policy.
-- -------------------------------------------------------------------------
drop policy if exists "Owners and admins can update or remove workspace members" on public.workspace_members;

-- -------------------------------------------------------------------------
-- 3. Invite acceptance must not silently change an existing member's role and
--    must not falsely fail on seat limits for someone who already holds a seat.
--    - Already-active member: accept invite idempotently, keep current role,
--      consume no new seat. Role changes are a separate, audited operation.
--    - New/removed member: enforce the seat limit, then activate.
-- -------------------------------------------------------------------------
create or replace function public.accept_workspace_invite(target_invite_id uuid,target_user_id uuid)
returns table(workspace_id uuid,role text) language plpgsql security definer set search_path=public as $$
declare invite public.workspace_invites%rowtype; active_seats integer; seat_limit integer; existing_role text;
begin
  select * into invite from public.workspace_invites where id=target_invite_id for update;
  if not found or invite.status<>'pending' or invite.expires_at<=now() then raise exception 'invite is not active'; end if;
  perform pg_advisory_xact_lock(hashtextextended(invite.workspace_id::text,1));

  select wm.role into existing_role from public.workspace_members wm
   where wm.workspace_id=invite.workspace_id and wm.user_id=target_user_id and wm.status='active';

  if existing_role is not null then
    -- Idempotent accept: consume no seat, preserve current role.
    update public.workspace_invites set status='accepted',accepted_at=now() where id=invite.id;
    insert into public.audit_logs(actor_user_id,workspace_id,action,target_type,target_id,metadata)
      values(target_user_id,invite.workspace_id,'invite.accepted','workspace_invite',invite.id::text,jsonb_build_object('role',existing_role,'note','already_member'));
    return query select invite.workspace_id,existing_role;
    return;
  end if;

  select count(*) into active_seats from public.workspace_members where workspace_members.workspace_id=invite.workspace_id and status='active';
  select max_seats into seat_limit from public.entitlement_limits(invite.workspace_id);
  if active_seats>=seat_limit then raise exception 'workspace seat entitlement exceeded'; end if;
  insert into public.workspace_members(workspace_id,user_id,role,status) values(invite.workspace_id,target_user_id,invite.role,'active')
  on conflict(workspace_id,user_id) do update set role=excluded.role,status='active';
  update public.workspace_invites set status='accepted',accepted_at=now() where id=invite.id;
  insert into public.audit_logs(actor_user_id,workspace_id,action,target_type,target_id,metadata) values(target_user_id,invite.workspace_id,'invite.accepted','workspace_invite',invite.id::text,jsonb_build_object('role',invite.role));
  return query select invite.workspace_id,invite.role;
end;
$$;

revoke all on function public.accept_workspace_invite(uuid,uuid) from public;
grant execute on function public.accept_workspace_invite(uuid,uuid) to service_role;
