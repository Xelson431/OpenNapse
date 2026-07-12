-- Additional workspace lifecycle and invite integrity fixes.
-- Forward-only: replaces functions from 20260711050000 and adds a table +
-- constraint for create_workspace idempotency and duplicate-invite prevention.

-- -------------------------------------------------------------------------
-- 1. create_workspace idempotency for team workspaces.
--    The public API already advertises an idempotency_key; make it real so a
--    retried team-create does not create a second workspace and burn the cap.
-- -------------------------------------------------------------------------
create table if not exists public.workspace_create_requests (
  caller uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (caller, idempotency_key)
);

alter table public.workspace_create_requests enable row level security;
-- No browser policies: only the SECURITY DEFINER RPC (and service_role) touch it.

create or replace function public.create_workspace(
  requested_name text,
  requested_type text default 'personal',
  idempotency_key uuid default gen_random_uuid()
)
returns table (workspace_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  caller uuid := auth.uid();
  existing_id uuid;
  new_id uuid;
  owned_count integer;
  allowed_workspaces integer;
  replayed_id uuid;
begin
  if caller is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if requested_type not in ('personal', 'team') then raise exception 'invalid workspace type'; end if;
  if nullif(btrim(requested_name), '') is null or length(requested_name) > 120 then
    raise exception 'workspace name must be between 1 and 120 characters';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));

  -- Idempotent replay: same caller + key returns the original workspace.
  select r.workspace_id into replayed_id from public.workspace_create_requests r
   where r.caller = caller and r.idempotency_key = idempotency_key;
  if replayed_id is not null then
    return query select replayed_id, false;
    return;
  end if;

  if requested_type = 'personal' then
    select id into existing_id from public.workspaces
     where owner_user_id = caller and type = 'personal' limit 1;
    if existing_id is not null then
      insert into public.workspace_members(workspace_id,user_id,role,status)
      values(existing_id,caller,'owner','active')
      on conflict(workspace_id,user_id) do update set role='owner',status='active';
      insert into public.workspace_create_requests(caller, idempotency_key, workspace_id)
      values (caller, idempotency_key, existing_id)
      on conflict do nothing;
      return query select existing_id, false;
      return;
    end if;
  end if;

  select count(*) into owned_count from public.workspaces where owner_user_id = caller;
  select coalesce(max(l.max_workspaces), 1) into allowed_workspaces
    from public.workspace_members member
    cross join lateral public.entitlement_limits(member.workspace_id) l
   where member.user_id = caller and member.status = 'active' and member.role = 'owner';
  allowed_workspaces := coalesce(allowed_workspaces, 1);
  if owned_count >= allowed_workspaces then raise exception 'workspace entitlement exceeded' using errcode = 'P0001'; end if;

  insert into public.workspaces(type, name, owner_user_id)
  values (requested_type, btrim(requested_name), caller)
  returning id into new_id;

  insert into public.workspace_members(workspace_id, user_id, role, status)
  values (new_id, caller, 'owner', 'active');

  insert into public.workspace_create_requests(caller, idempotency_key, workspace_id)
  values (caller, idempotency_key, new_id);

  insert into public.audit_logs(actor_user_id, workspace_id, action, metadata)
  values (caller, new_id, 'workspace.created', jsonb_build_object('idempotencyKey', idempotency_key));

  return query select new_id, true;
end;
$$;

revoke all on function public.create_workspace(text, text, uuid) from public;
grant execute on function public.create_workspace(text, text, uuid) to authenticated;

-- -------------------------------------------------------------------------
-- 2. Block ownership transfer while a workspace deletion is pending, so a
--    departing owner cannot hand off a workspace that is scheduled to vanish
--    and that the new owner cannot cancel.
-- -------------------------------------------------------------------------
create or replace function public.transfer_workspace_ownership(target_workspace_id uuid, new_owner_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform 1 from public.workspaces where id = target_workspace_id and owner_user_id = caller for update;
  if not found then raise exception 'only the current owner can transfer ownership' using errcode = '42501'; end if;

  if exists (
    select 1 from public.deletion_requests
     where workspace_id = target_workspace_id
       and status in ('pending', 'approved', 'executing')
  ) then
    raise exception 'cancel the pending workspace deletion before transferring ownership' using errcode = 'P0001';
  end if;

  perform 1 from public.workspace_members
   where workspace_id = target_workspace_id and user_id = new_owner_user_id and status = 'active' for update;
  if not found then raise exception 'new owner must be an active workspace member'; end if;

  update public.workspace_members set role = 'admin'
   where workspace_id = target_workspace_id and user_id = caller;
  update public.workspace_members set role = 'owner', status = 'active'
   where workspace_id = target_workspace_id and user_id = new_owner_user_id;
  update public.workspaces set owner_user_id = new_owner_user_id where id = target_workspace_id;
  insert into public.audit_logs(actor_user_id, workspace_id, action, metadata)
  values (caller, target_workspace_id, 'workspace.ownership_transferred', jsonb_build_object('newOwnerUserId', new_owner_user_id));
end;
$$;

revoke all on function public.transfer_workspace_ownership(uuid, uuid) from public;
grant execute on function public.transfer_workspace_ownership(uuid, uuid) to authenticated;

-- -------------------------------------------------------------------------
-- 3. Prevent duplicate pending invites for the same email in a workspace.
--    A partial unique index keeps one live invite per (workspace, email).
-- -------------------------------------------------------------------------
create unique index if not exists one_pending_invite_per_workspace_email_idx
  on public.workspace_invites(workspace_id, lower(email))
  where status = 'pending';
