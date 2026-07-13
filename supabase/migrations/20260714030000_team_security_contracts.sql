-- Team ownership and atomic creation contracts.
-- Browser clients may create only a team with its first workspace. Adding
-- members is invitation-only; arbitrary team/workspace attachment stays closed.

alter table public.teams alter column created_by drop not null;

alter table public.teams drop constraint if exists teams_owner_user_id_fkey;
alter table public.teams
  add constraint teams_owner_user_id_fkey
  foreign key (owner_user_id) references auth.users(id) on delete restrict;

create table if not exists public.team_creation_requests (
  caller uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  request_fingerprint text not null,
  team_id uuid not null references public.teams(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (caller, idempotency_key)
);

alter table public.team_creation_requests enable row level security;
-- No browser policies. Only create_team_with_workspace writes this ledger.

create or replace function public.enforce_team_owner_invariant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_recorded_owner uuid;
  v_owner_count integer;
  v_matching_count integer;
begin
  if tg_table_name = 'teams' then
    v_team_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_team_id := case when tg_op = 'DELETE' then old.team_id else new.team_id end;
  end if;

  select team.owner_user_id
    into v_recorded_owner
    from public.teams team
   where team.id = v_team_id;

  if not found then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select count(*), count(*) filter (where member.user_id = v_recorded_owner)
    into v_owner_count, v_matching_count
    from public.team_members member
   where member.team_id = v_team_id
     and member.role = 'owner'
     and member.status = 'active';

  if v_owner_count <> 1 or v_matching_count <> 1 then
    raise exception 'team must have exactly one active owner matching owner_user_id';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists teams_owner_invariant on public.teams;
create constraint trigger teams_owner_invariant
  after insert or update on public.teams
  deferrable initially deferred
  for each row execute function public.enforce_team_owner_invariant();

drop trigger if exists team_members_owner_invariant on public.team_members;
create constraint trigger team_members_owner_invariant
  after insert or update or delete on public.team_members
  deferrable initially deferred
  for each row execute function public.enforce_team_owner_invariant();

create or replace function public.create_team_with_workspace(
  requested_team_name text,
  requested_workspace_name text,
  idempotency_key uuid default gen_random_uuid()
)
returns table (team_id uuid, workspace_id uuid, created boolean)
language plpgsql
security definer
-- extensions on the path so pgcrypto's digest() resolves on Supabase and
-- bare self-host Postgres alike.
set search_path = public, extensions
as $$
#variable_conflict error
declare
  p_team_name alias for $1;
  p_workspace_name alias for $2;
  p_idempotency_key alias for $3;
  v_caller uuid := auth.uid();
  v_team_name text := btrim(p_team_name);
  v_workspace_name text := btrim(p_workspace_name);
  v_fingerprint text;
  v_replayed_team_id uuid;
  v_replayed_workspace_id uuid;
  v_replayed_fingerprint text;
  v_team_id uuid;
  v_workspace_id uuid;
  v_workspace_created boolean;
begin
  if v_caller is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if nullif(v_team_name, '') is null or length(v_team_name) > 120 then
    raise exception 'team name must be between 1 and 120 characters';
  end if;
  if nullif(v_workspace_name, '') is null or length(v_workspace_name) > 120 then
    raise exception 'workspace name must be between 1 and 120 characters';
  end if;

  v_fingerprint := encode(digest('create-team-workspace:v1|' || v_team_name || '|' || v_workspace_name, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_caller::text, 0));

  select request.team_id, request.workspace_id, request.request_fingerprint
    into v_replayed_team_id, v_replayed_workspace_id, v_replayed_fingerprint
    from public.team_creation_requests request
   where request.caller = v_caller
     and request.idempotency_key = p_idempotency_key;

  if found then
    if v_replayed_fingerprint <> v_fingerprint then
      raise exception 'idempotency key was already used for a different team request' using errcode = 'P0001';
    end if;
    return query select v_replayed_team_id, v_replayed_workspace_id, false;
    return;
  end if;

  select workspace_result.workspace_id, workspace_result.created
    into v_workspace_id, v_workspace_created
    from public.create_workspace(v_workspace_name, 'team', p_idempotency_key) workspace_result;

  if not v_workspace_created then
    raise exception 'team workspace idempotency conflict; retry with a new key' using errcode = 'P0001';
  end if;

  insert into public.teams(name, owner_user_id, created_by)
  values (v_team_name, v_caller, v_caller)
  returning id into v_team_id;

  insert into public.team_members(team_id, user_id, role, status)
  values (v_team_id, v_caller, 'owner', 'active');

  insert into public.team_workspaces(team_id, workspace_id)
  values (v_team_id, v_workspace_id);

  insert into public.team_creation_requests(caller, idempotency_key, request_fingerprint, team_id, workspace_id)
  values (v_caller, p_idempotency_key, v_fingerprint, v_team_id, v_workspace_id);

  insert into public.audit_logs(actor_user_id, workspace_id, action, target_type, target_id, metadata)
  values (v_caller, v_workspace_id, 'team.created_with_workspace', 'team', v_team_id::text,
    jsonb_build_object('teamName', v_team_name, 'workspaceName', v_workspace_name, 'idempotencyKey', p_idempotency_key));

  return query select v_team_id, v_workspace_id, true;
end;
$$;

revoke all on function public.create_team_with_workspace(text, text, uuid) from public;
grant execute on function public.create_team_with_workspace(text, text, uuid) to authenticated;

create or replace function public.transfer_team_ownership(target_team_id uuid, new_owner_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_current_owner uuid;
begin
  if v_caller is null then raise exception 'authentication required' using errcode = '28000'; end if;

  select team.owner_user_id
    into v_current_owner
    from public.teams team
   where team.id = target_team_id
   for update;

  if not found then raise exception 'team not found' using errcode = 'P0002'; end if;
  if v_current_owner <> v_caller then
    raise exception 'only the current owner can transfer team ownership' using errcode = '42501';
  end if;
  if new_owner_user_id = v_caller then return; end if;

  perform 1
    from public.team_members member
   where member.team_id = target_team_id
     and member.user_id = new_owner_user_id
     and member.status = 'active'
   for update;
  if not found then raise exception 'new owner must be an active team member'; end if;

  update public.team_members set role = 'admin'
   where team_id = target_team_id and user_id = v_caller;
  update public.team_members set role = 'owner', status = 'active'
   where team_id = target_team_id and user_id = new_owner_user_id;
  update public.teams set owner_user_id = new_owner_user_id, updated_at = now()
   where id = target_team_id;

  insert into public.audit_logs(actor_user_id, action, target_type, target_id, metadata)
  values (v_caller, 'team.ownership_transferred', 'team', target_team_id::text,
    jsonb_build_object('newOwnerUserId', new_owner_user_id));
end;
$$;

revoke all on function public.transfer_team_ownership(uuid, uuid) from public;
grant execute on function public.transfer_team_ownership(uuid, uuid) to authenticated;

create or replace function public.remove_team_member(target_team_id uuid, target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_role text;
  v_target_role text;
begin
  if v_caller is null then raise exception 'authentication required' using errcode = '28000'; end if;

  perform 1 from public.teams team where team.id = target_team_id for update;
  if not found then raise exception 'team not found' using errcode = 'P0002'; end if;

  select member.role into v_caller_role
    from public.team_members member
   where member.team_id = target_team_id
     and member.user_id = v_caller
     and member.status = 'active';
  select member.role into v_target_role
    from public.team_members member
   where member.team_id = target_team_id
     and member.user_id = target_user_id
     and member.status = 'active'
   for update;

  if v_target_role is null then raise exception 'active team member not found'; end if;
  if v_target_role = 'owner' then raise exception 'transfer team ownership before removing the owner'; end if;

  if v_caller <> target_user_id then
    if v_caller_role not in ('owner', 'admin') then
      raise exception 'team administration required' using errcode = '42501';
    end if;
    if v_caller_role = 'admin' and v_target_role = 'admin' then
      raise exception 'admins cannot remove other admins' using errcode = '42501';
    end if;
  end if;

  update public.team_members set status = 'removed'
   where team_id = target_team_id and user_id = target_user_id;

  insert into public.audit_logs(actor_user_id, action, target_type, target_id, metadata)
  values (v_caller, 'team.member_removed', 'team', target_team_id::text,
    jsonb_build_object('userId', target_user_id));
end;
$$;

revoke all on function public.remove_team_member(uuid, uuid) from public;
grant execute on function public.remove_team_member(uuid, uuid) to authenticated;

-- Close the incomplete direct mutation surface. Invitations are the only path
-- for adding users, and this release does not expose arbitrary attachments.
revoke execute on function public.create_team(text) from authenticated;
revoke execute on function public.add_team_member(uuid, uuid, text) from authenticated;
revoke execute on function public.attach_team_to_workspace(uuid, uuid) from authenticated;
revoke execute on function public.detach_team_from_workspace(uuid, uuid) from authenticated;
