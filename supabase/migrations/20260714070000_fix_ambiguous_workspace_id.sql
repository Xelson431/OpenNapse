-- HOTFIX: create_workspace / create_team_with_workspace ambiguous column ref.
--
-- 20260714020000 and 20260714030000 set `#variable_conflict error`. Because
-- both functions declare an OUT column named workspace_id (via RETURNS TABLE),
-- the bare workspace_id in `on conflict (workspace_id, user_id)` and in INSERT
-- target lists became ambiguous against the OUT column, raising
--   "column reference \"workspace_id\" is ambiguous"
-- at runtime. This only fires on the personal-workspace *reuse* branch (a
-- returning user re-bootstrapping) and the team-create path, so brand-new CI
-- users never hit it and it reached production.
--
-- Fix: use `#variable_conflict use_column` (as the original create_workspace
-- did). All locals/params here are v_*/p_* prefixed, so no variable shares a
-- column name — the historical `use_column` tautology bug (bare caller=caller)
-- cannot recur. use_column only resolves the OUT-named identifiers, which are
-- exactly the table columns intended in the ON CONFLICT / INSERT clauses.

create or replace function public.create_workspace(
  requested_name text,
  requested_type text default 'personal',
  idempotency_key uuid default gen_random_uuid()
)
returns table (workspace_id uuid, created boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
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

-- Same ambiguous-OUT-column fix for the atomic team creation RPC.
create or replace function public.create_team_with_workspace(
  requested_team_name text,
  requested_workspace_name text,
  idempotency_key uuid default gen_random_uuid()
)
returns table (team_id uuid, workspace_id uuid, created boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
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
