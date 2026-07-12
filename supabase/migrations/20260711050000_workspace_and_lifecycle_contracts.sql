-- Transactional workspace and lifecycle contracts.
-- Browser clients must use these RPCs instead of mutating ownership or
-- deletion state directly.

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
declare
  resolved_plan text;
  sub_status text;
  sub_period_end timestamptz;
begin
  select coalesce(ws.plan_id, 'free'), ws.status, ws.current_period_end
    into resolved_plan, sub_status, sub_period_end
    from public.workspace_subscriptions ws
   where ws.workspace_id = target_workspace_id;
  return query select
    coalesce(resolved_plan, 'free')::text,
    1,
    1,
    10,
    5,
    null::timestamptz;
end;
$$;

revoke all on function public.entitlement_limits(uuid) from public;
grant execute on function public.entitlement_limits(uuid) to authenticated, service_role;

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
begin
  if caller is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if requested_type not in ('personal', 'team') then raise exception 'invalid workspace type'; end if;
  if nullif(btrim(requested_name), '') is null or length(requested_name) > 120 then
    raise exception 'workspace name must be between 1 and 120 characters';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));

  if requested_type = 'personal' then
    select id into existing_id from public.workspaces
     where owner_user_id = caller and type = 'personal' limit 1;
    if existing_id is not null then
      insert into public.workspace_members(workspace_id,user_id,role,status)
      values(existing_id,caller,'owner','active')
      on conflict(workspace_id,user_id) do update set role='owner',status='active';
      return query select existing_id, false;
      return;
    end if;
  end if;

  select count(*) into owned_count from public.workspaces where owner_user_id = caller;
  -- A user without a workspace receives the Free allowance. Creating further
  -- workspaces requires an entitlement supplied by an existing Pro workspace.
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

  insert into public.audit_logs(actor_user_id, workspace_id, action, metadata)
  values (caller, new_id, 'workspace.created', jsonb_build_object('idempotencyKey', idempotency_key));

  return query select new_id, true;
end;
$$;

revoke all on function public.create_workspace(text, text, uuid) from public;
grant execute on function public.create_workspace(text, text, uuid) to authenticated;

-- Ownership fields cannot drift through direct REST updates.
create or replace function public.enforce_workspace_owner_invariant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare target_workspace_id uuid; recorded_owner uuid; owner_count integer; matching_count integer;
begin
  target_workspace_id := case when tg_table_name='workspaces' then coalesce(new.id,old.id) else coalesce(new.workspace_id,old.workspace_id) end;
  select owner_user_id into recorded_owner from public.workspaces where id=target_workspace_id;
  if not found then if tg_op='DELETE' then return old; else return new; end if; end if;
  select count(*),count(*) filter(where user_id=recorded_owner) into owner_count,matching_count
    from public.workspace_members where workspace_id=target_workspace_id and role='owner' and status='active';
  if owner_count<>1 or matching_count<>1 then raise exception 'workspace must have exactly one active owner matching owner_user_id'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists workspaces_owner_invariant on public.workspaces;
create constraint trigger workspaces_owner_invariant after insert or update on public.workspaces
  deferrable initially deferred
  for each row execute function public.enforce_workspace_owner_invariant();
drop trigger if exists workspace_members_owner_invariant on public.workspace_members;
create constraint trigger workspace_members_owner_invariant after insert or update or delete on public.workspace_members
  deferrable initially deferred
  for each row execute function public.enforce_workspace_owner_invariant();

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

-- Clients cannot manufacture lifecycle state. They can only request/cancel.
drop policy if exists "workspace owners request workspace deletion" on public.deletion_requests;
drop policy if exists "users cancel pending deletion requests" on public.deletion_requests;

create unique index if not exists one_active_deletion_request_per_scope_idx
  on public.deletion_requests(scope, coalesce(workspace_id, requested_by))
  where status in ('pending', 'approved', 'executing');

create or replace function public.request_deletion(requested_scope text, target_workspace_id uuid default null)
returns table (request_id uuid, confirmation_token uuid, scheduled_for timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare caller uuid := auth.uid(); new_id uuid; token uuid := gen_random_uuid(); schedule timestamptz := now() + interval '30 days';
begin
  if caller is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if requested_scope not in ('workspace', 'account') then raise exception 'invalid deletion scope'; end if;
  if requested_scope = 'workspace' then
    if target_workspace_id is null then raise exception 'workspace required'; end if;
    perform 1 from public.workspaces where id = target_workspace_id and owner_user_id = caller;
    if not found then raise exception 'only the owner can request deletion' using errcode = '42501'; end if;
  elsif target_workspace_id is not null then
    raise exception 'account deletion cannot target a workspace';
  end if;
  insert into public.deletion_requests(scope, workspace_id, requested_by, confirmation_token, scheduled_for)
  values (requested_scope, target_workspace_id, caller, token, schedule)
  returning id into new_id;
  insert into public.audit_logs(actor_user_id, workspace_id, action, metadata)
  values (caller, target_workspace_id, 'deletion.requested', jsonb_build_object('scope', requested_scope, 'requestId', new_id));
  return query select new_id, token, schedule;
end;
$$;

create or replace function public.cancel_deletion(target_request_id uuid, supplied_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare caller uuid := auth.uid(); target_workspace uuid;
begin
  update public.deletion_requests
     set status = 'cancelled', cancelled_at = now()
   where id = target_request_id and requested_by = caller and status = 'pending'
     and confirmation_token = supplied_token
  returning workspace_id into target_workspace;
  if not found then raise exception 'deletion request not found or cannot be cancelled' using errcode = 'P0002'; end if;
  insert into public.audit_logs(actor_user_id, workspace_id, action, metadata)
  values (caller, target_workspace, 'deletion.cancelled', jsonb_build_object('requestId', target_request_id));
end;
$$;

revoke all on function public.request_deletion(text, uuid) from public;
revoke all on function public.cancel_deletion(uuid, uuid) from public;
grant execute on function public.request_deletion(text, uuid) to authenticated;
grant execute on function public.cancel_deletion(uuid, uuid) to authenticated;
