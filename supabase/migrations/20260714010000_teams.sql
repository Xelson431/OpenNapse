-- Multi-team collaboration.
-- Teams are account-level groups of users. A team can be attached to many
-- workspaces (many-to-many), and a user can own/belong to many teams. Attaching
-- a team to a workspace grants its active members access to that workspace's
-- content (additive to direct workspace_members).
--
-- Additive & safe: when no team data exists, the extended access helpers behave
-- identically to before, so existing self-host and hosted deployments are
-- unaffected until teams are actually used.

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  status text not null check (status in ('active', 'removed')) default 'active',
  created_at timestamptz not null default now(),
  unique (team_id, user_id)
);

create table if not exists public.team_workspaces (
  team_id uuid not null references public.teams(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, workspace_id)
);

create index if not exists teams_owner_idx on public.teams(owner_user_id);
create index if not exists team_members_user_idx on public.team_members(user_id);
create index if not exists team_members_team_idx on public.team_members(team_id);
create index if not exists team_workspaces_workspace_idx on public.team_workspaces(workspace_id);

-- Non-recursive membership helpers (security definer bypasses RLS on the team
-- tables so RLS policies that call them cannot recurse).
create or replace function public.is_team_member(target_team_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members
    where team_id = target_team_id and user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.is_team_admin(target_team_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members
    where team_id = target_team_id and user_id = auth.uid()
      and status = 'active' and role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_team_member(uuid) from public;
revoke all on function public.is_team_admin(uuid) from public;
grant execute on function public.is_team_member(uuid) to authenticated, service_role;
grant execute on function public.is_team_admin(uuid) to authenticated, service_role;

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_workspaces enable row level security;

-- Reads only. All writes go through the security-definer RPCs below so the
-- invariants (single active owner, membership checks) cannot be bypassed.
create policy "team members read their teams"
  on public.teams for select
  using (owner_user_id = auth.uid() or public.is_team_member(id));

create policy "members read their own team membership; admins read all"
  on public.team_members for select
  using (user_id = auth.uid() or public.is_team_admin(team_id));

create policy "team members read team workspace links"
  on public.team_workspaces for select
  using (public.is_team_member(team_id));

-- -------------------------------------------------------------------------
-- Extend workspace access to include team members. Redefined as SECURITY
-- DEFINER so the team lookups bypass RLS and cannot recurse. Additive: direct
-- workspace_members still grant access exactly as before; team attachment is
-- an extra path.
-- -------------------------------------------------------------------------
create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace_id and m.user_id = auth.uid() and m.status = 'active'
  ) or exists (
    select 1
    from public.team_workspaces tw
    join public.team_members tm on tm.team_id = tw.team_id
    where tw.workspace_id = target_workspace_id
      and tm.user_id = auth.uid() and tm.status = 'active'
  );
$$;

create or replace function public.can_edit_workspace(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace_id and m.user_id = auth.uid()
      and m.status = 'active' and m.role in ('owner', 'admin', 'member')
  ) or exists (
    select 1
    from public.team_workspaces tw
    join public.team_members tm on tm.team_id = tw.team_id
    where tw.workspace_id = target_workspace_id
      and tm.user_id = auth.uid() and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'member')
  );
$$;

-- -------------------------------------------------------------------------
-- Transactional team RPCs. All writes flow through these; the tables have no
-- browser write policies.
-- -------------------------------------------------------------------------
create or replace function public.create_team(requested_name text)
returns table (team_id uuid) language plpgsql security definer set search_path = public as $$
declare caller uuid := auth.uid(); new_id uuid;
begin
  if caller is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if nullif(btrim(requested_name), '') is null or length(requested_name) > 120 then
    raise exception 'team name must be between 1 and 120 characters';
  end if;
  insert into public.teams(name, owner_user_id, created_by)
  values (btrim(requested_name), caller, caller) returning id into new_id;
  insert into public.team_members(team_id, user_id, role, status)
  values (new_id, caller, 'owner', 'active');
  insert into public.audit_logs(actor_user_id, action, target_type, target_id, metadata)
  values (caller, 'team.created', 'team', new_id::text, jsonb_build_object('name', btrim(requested_name)));
  return query select new_id;
end;
$$;

create or replace function public.add_team_member(target_team_id uuid, target_user_id uuid, member_role text default 'member')
returns void language plpgsql security definer set search_path = public as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not public.is_team_admin(target_team_id) then raise exception 'team administration required' using errcode = '42501'; end if;
  if member_role not in ('admin', 'member', 'viewer') then raise exception 'invalid team role'; end if;
  insert into public.team_members(team_id, user_id, role, status)
  values (target_team_id, target_user_id, member_role, 'active')
  on conflict (team_id, user_id) do update set role = excluded.role, status = 'active';
  insert into public.audit_logs(actor_user_id, action, target_type, target_id, metadata)
  values (caller, 'team.member_added', 'team', target_team_id::text, jsonb_build_object('userId', target_user_id, 'role', member_role));
end;
$$;

create or replace function public.remove_team_member(target_team_id uuid, target_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare caller uuid := auth.uid(); target_role text;
begin
  if caller is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not public.is_team_admin(target_team_id) then raise exception 'team administration required' using errcode = '42501'; end if;
  select role into target_role from public.team_members where team_id = target_team_id and user_id = target_user_id and status = 'active';
  if target_role = 'owner' then raise exception 'transfer team ownership before removing the owner'; end if;
  update public.team_members set status = 'removed' where team_id = target_team_id and user_id = target_user_id;
  insert into public.audit_logs(actor_user_id, action, target_type, target_id, metadata)
  values (caller, 'team.member_removed', 'team', target_team_id::text, jsonb_build_object('userId', target_user_id));
end;
$$;

create or replace function public.attach_team_to_workspace(target_team_id uuid, target_workspace_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not public.is_team_admin(target_team_id) then raise exception 'team administration required' using errcode = '42501'; end if;
  -- Only a workspace owner/admin can grant a team access to that workspace.
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace_id and m.user_id = caller
      and m.status = 'active' and m.role in ('owner', 'admin')
  ) then raise exception 'workspace administration required to attach a team' using errcode = '42501'; end if;
  insert into public.team_workspaces(team_id, workspace_id) values (target_team_id, target_workspace_id)
  on conflict do nothing;
  insert into public.audit_logs(actor_user_id, workspace_id, action, target_type, target_id)
  values (caller, target_workspace_id, 'team.attached_to_workspace', 'team', target_team_id::text);
end;
$$;

create or replace function public.detach_team_from_workspace(target_team_id uuid, target_workspace_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not (public.is_team_admin(target_team_id) or exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace_id and m.user_id = caller
      and m.status = 'active' and m.role in ('owner', 'admin')
  )) then raise exception 'team or workspace administration required' using errcode = '42501'; end if;
  delete from public.team_workspaces where team_id = target_team_id and workspace_id = target_workspace_id;
  insert into public.audit_logs(actor_user_id, workspace_id, action, target_type, target_id)
  values (caller, target_workspace_id, 'team.detached_from_workspace', 'team', target_team_id::text);
end;
$$;

revoke all on function public.create_team(text) from public;
revoke all on function public.add_team_member(uuid, uuid, text) from public;
revoke all on function public.remove_team_member(uuid, uuid) from public;
revoke all on function public.attach_team_to_workspace(uuid, uuid) from public;
revoke all on function public.detach_team_from_workspace(uuid, uuid) from public;
grant execute on function public.create_team(text) to authenticated;
grant execute on function public.add_team_member(uuid, uuid, text) to authenticated;
grant execute on function public.remove_team_member(uuid, uuid) to authenticated;
grant execute on function public.attach_team_to_workspace(uuid, uuid) to authenticated;
grant execute on function public.detach_team_from_workspace(uuid, uuid) to authenticated;
