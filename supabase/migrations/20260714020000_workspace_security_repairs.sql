-- Workspace security and concurrency repairs.
-- Forward-only: fixes create_workspace replay isolation, effective membership,
-- seat counting, write-rate serialization, and task attribution.

alter table public.workspace_create_requests
  add column if not exists request_fingerprint text;

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
#variable_conflict error
declare
  p_requested_name alias for $1;
  p_requested_type alias for $2;
  p_idempotency_key alias for $3;
  v_caller uuid := auth.uid();
  v_normalized_name text := btrim(p_requested_name);
  v_fingerprint text;
  v_existing_id uuid;
  v_new_id uuid;
  v_owned_count integer;
  v_allowed_workspaces integer;
  v_replayed_id uuid;
  v_replayed_fingerprint text;
begin
  if v_caller is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_requested_type not in ('personal', 'team') then
    raise exception 'invalid workspace type';
  end if;
  if nullif(v_normalized_name, '') is null or length(v_normalized_name) > 120 then
    raise exception 'workspace name must be between 1 and 120 characters';
  end if;

  v_fingerprint := encode(digest('create-workspace:v1|' || v_normalized_name || '|' || p_requested_type, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_caller::text, 0));

  select request.workspace_id, request.request_fingerprint
    into v_replayed_id, v_replayed_fingerprint
    from public.workspace_create_requests request
   where request.caller = v_caller
     and request.idempotency_key = p_idempotency_key;

  if found then
    if v_replayed_fingerprint is null then
      raise exception 'legacy idempotency key cannot be replayed; retry with a new key' using errcode = 'P0001';
    end if;
    if v_replayed_fingerprint <> v_fingerprint then
      raise exception 'idempotency key was already used for a different workspace request' using errcode = 'P0001';
    end if;
    return query select v_replayed_id, false;
    return;
  end if;

  if p_requested_type = 'personal' then
    select workspace.id
      into v_existing_id
      from public.workspaces workspace
     where workspace.owner_user_id = v_caller
       and workspace.type = 'personal'
     limit 1;
    if v_existing_id is not null then
      insert into public.workspace_members(workspace_id, user_id, role, status)
      values(v_existing_id, v_caller, 'owner', 'active')
      on conflict(workspace_id, user_id) do update set role = 'owner', status = 'active';

      insert into public.workspace_create_requests(caller, idempotency_key, workspace_id, request_fingerprint)
      values (v_caller, p_idempotency_key, v_existing_id, v_fingerprint);

      return query select v_existing_id, false;
      return;
    end if;
  end if;

  select count(*)
    into v_owned_count
    from public.workspaces workspace
   where workspace.owner_user_id = v_caller;

  select coalesce(max(limits.max_workspaces), 1)
    into v_allowed_workspaces
    from public.workspace_members member
    cross join lateral public.entitlement_limits(member.workspace_id) limits
   where member.user_id = v_caller
     and member.status = 'active'
     and member.role = 'owner';

  v_allowed_workspaces := coalesce(v_allowed_workspaces, 1);
  if v_owned_count >= v_allowed_workspaces then
    raise exception 'workspace entitlement exceeded' using errcode = 'P0001';
  end if;

  insert into public.workspaces(type, name, owner_user_id)
  values (p_requested_type, v_normalized_name, v_caller)
  returning id into v_new_id;

  insert into public.workspace_members(workspace_id, user_id, role, status)
  values (v_new_id, v_caller, 'owner', 'active');

  insert into public.workspace_create_requests(caller, idempotency_key, workspace_id, request_fingerprint)
  values (v_caller, p_idempotency_key, v_new_id, v_fingerprint);

  insert into public.audit_logs(actor_user_id, workspace_id, action, metadata)
  values (v_caller, v_new_id, 'workspace.created', jsonb_build_object('idempotencyKey', p_idempotency_key));

  return query select v_new_id, true;
end;
$$;

revoke all on function public.create_workspace(text, text, uuid) from public;
grant execute on function public.create_workspace(text, text, uuid) to authenticated;

create or replace function public.is_workspace_member_for_user(target_workspace_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.workspace_members member
     where member.workspace_id = target_workspace_id
       and member.user_id = target_user_id
       and member.status = 'active'
  ) or exists (
    select 1
      from public.team_workspaces team_workspace
      join public.team_members team_member on team_member.team_id = team_workspace.team_id
     where team_workspace.workspace_id = target_workspace_id
       and team_member.user_id = target_user_id
       and team_member.status = 'active'
  );
$$;

revoke all on function public.is_workspace_member_for_user(uuid, uuid) from public;
grant execute on function public.is_workspace_member_for_user(uuid, uuid) to service_role;

create or replace function public.effective_workspace_member_count(target_workspace_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from (
      select member.user_id
        from public.workspace_members member
       where member.workspace_id = target_workspace_id
         and member.status = 'active'
      union
      select team_member.user_id
        from public.team_workspaces team_workspace
        join public.team_members team_member on team_member.team_id = team_workspace.team_id
       where team_workspace.workspace_id = target_workspace_id
         and team_member.status = 'active'
    ) effective_members;
$$;

revoke all on function public.effective_workspace_member_count(uuid) from public;
grant execute on function public.effective_workspace_member_count(uuid) to service_role;

create or replace function public.workspace_capacity_limit(target_workspace_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer;
begin
  if auth.role() <> 'service_role'
     and not public.is_workspace_member(target_workspace_id) then
    raise exception 'not authorized to read workspace capacity' using errcode = '42501';
  end if;

  select limits.max_seats
    into v_limit
    from public.entitlement_limits(target_workspace_id) limits;
  return coalesce(v_limit, 1);
end;
$$;

revoke all on function public.workspace_capacity_limit(uuid) from public;
grant execute on function public.workspace_capacity_limit(uuid) to authenticated, service_role;

drop policy if exists "Workspace members can read active workspaces" on public.workspaces;
create policy "Workspace members can read active workspaces"
  on public.workspaces for select
  using (owner_user_id = auth.uid() or public.is_workspace_member(id));

create or replace function public.accept_workspace_invite(target_invite_id uuid, target_user_id uuid)
returns table(workspace_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.workspace_invites%rowtype;
  v_active_seats integer;
  v_seat_limit integer;
  v_existing_role text;
  v_already_effective boolean;
begin
  select *
    into v_invite
    from public.workspace_invites invite
   where invite.id = target_invite_id
   for update;

  if not found or v_invite.status <> 'pending' or v_invite.expires_at <= now() then
    raise exception 'invite is not active';
  end if;

  perform 1 from public.workspaces workspace where workspace.id = v_invite.workspace_id for update;

  select member.role
    into v_existing_role
    from public.workspace_members member
   where member.workspace_id = v_invite.workspace_id
     and member.user_id = target_user_id
     and member.status = 'active';

  if v_existing_role is not null then
    update public.workspace_invites set status = 'accepted', accepted_at = now() where id = v_invite.id;
    insert into public.audit_logs(actor_user_id, workspace_id, action, target_type, target_id, metadata)
    values (target_user_id, v_invite.workspace_id, 'invite.accepted', 'workspace_invite', v_invite.id::text,
      jsonb_build_object('role', v_existing_role, 'note', 'already_direct_member'));
    return query select v_invite.workspace_id, v_existing_role;
    return;
  end if;

  v_already_effective := public.is_workspace_member_for_user(v_invite.workspace_id, target_user_id);
  if not v_already_effective then
    v_active_seats := public.effective_workspace_member_count(v_invite.workspace_id);
    v_seat_limit := public.workspace_capacity_limit(v_invite.workspace_id);
    if v_active_seats >= v_seat_limit then
      raise exception 'workspace seat entitlement exceeded' using errcode = 'P0001';
    end if;
  end if;

  insert into public.workspace_members(workspace_id, user_id, role, status)
  values (v_invite.workspace_id, target_user_id, v_invite.role, 'active')
  on conflict(workspace_id, user_id) do update set role = excluded.role, status = 'active';

  update public.workspace_invites set status = 'accepted', accepted_at = now() where id = v_invite.id;
  insert into public.audit_logs(actor_user_id, workspace_id, action, target_type, target_id, metadata)
  values (target_user_id, v_invite.workspace_id, 'invite.accepted', 'workspace_invite', v_invite.id::text,
    jsonb_build_object('role', v_invite.role));
  return query select v_invite.workspace_id, v_invite.role;
end;
$$;

revoke all on function public.accept_workspace_invite(uuid, uuid) from public;
grant execute on function public.accept_workspace_invite(uuid, uuid) to service_role;

create or replace function public.enforce_task_assignee_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assignee_id is not null
     and not public.is_workspace_member_for_user(new.workspace_id, new.assignee_id) then
    raise exception 'task assignee must be an active member of the workspace';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_task_updated_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.updated_by := old.updated_by;
  else
    new.updated_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_updated_by on public.tasks;
create trigger tasks_updated_by
  before insert or update on public.tasks
  for each row execute function public.enforce_task_updated_by();

create or replace function public.enforce_hosted_write_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_target_workspace uuid;
  v_operation_name text := tg_table_name || ':' || lower(tg_op);
  v_max_events integer;
  v_recent_events integer;
begin
  if v_caller is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then v_target_workspace := old.workspace_id;
  else v_target_workspace := new.workspace_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_caller::text || ':' || v_operation_name, 3));
  v_max_events := public.hosted_write_limit_for(v_operation_name);

  select count(*)
    into v_recent_events
    from public.rate_limit_events event
   where event.user_id = v_caller
     and event.operation = v_operation_name
     and event.created_at > now() - interval '1 minute';

  if v_recent_events >= v_max_events then
    raise exception 'OpenNapse write rate limit exceeded for %', v_operation_name using errcode = 'P0001';
  end if;

  insert into public.rate_limit_events(user_id, workspace_id, operation)
  values (v_caller, v_target_workspace, v_operation_name);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
