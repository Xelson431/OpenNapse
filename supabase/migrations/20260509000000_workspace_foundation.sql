-- OpenNapse workspace foundation.
-- This migration is the first cloud/team scaffold and should be applied before
-- any content table sync or hosted AI usage logging is enabled.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default 'Personal workspace',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('personal', 'team')),
  name text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  status text not null check (status in ('active', 'removed', 'pending')) default 'active',
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index if not exists workspaces_owner_user_id_idx on public.workspaces(owner_user_id);
create index if not exists workspace_members_user_id_idx on public.workspace_members(user_id);
create index if not exists workspace_members_workspace_id_idx on public.workspace_members(workspace_id);

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create policy "Users can read their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Workspace members can read active workspaces"
  on public.workspaces for select
  using (
    owner_user_id = auth.uid()
    or
    exists (
      select 1
      from public.workspace_members member
      where member.workspace_id = workspaces.id
        and member.user_id = auth.uid()
        and member.status = 'active'
    )
  );

create policy "Users can create owned workspaces"
  on public.workspaces for insert
  with check (auth.uid() = owner_user_id);

create policy "Owners and admins can update workspaces"
  on public.workspaces for update
  using (
    exists (
      select 1
      from public.workspace_members member
      where member.workspace_id = workspaces.id
        and member.user_id = auth.uid()
        and member.status = 'active'
        and member.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1
      from public.workspace_members member
      where member.workspace_id = workspaces.id
        and member.user_id = auth.uid()
        and member.status = 'active'
        and member.role in ('owner', 'admin')
    )
  );

create policy "Users can read their own memberships"
  on public.workspace_members for select
  using (user_id = auth.uid());

create policy "Users can create their own owner membership"
  on public.workspace_members for insert
  with check (
    auth.uid() = user_id
    and role = 'owner'
    and status = 'active'
    and exists (
      select 1
      from public.workspaces workspace
      where workspace.id = workspace_members.workspace_id
        and workspace.owner_user_id = auth.uid()
    )
  );

create policy "Owners and admins can update or remove workspace members"
  on public.workspace_members for update
  using (
    exists (
      select 1
      from public.workspace_members member
      where member.workspace_id = workspace_members.workspace_id
        and member.user_id = auth.uid()
        and member.status = 'active'
        and member.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1
      from public.workspace_members member
      where member.workspace_id = workspace_members.workspace_id
        and member.user_id = auth.uid()
        and member.status = 'active'
        and member.role in ('owner', 'admin')
    )
  );

create policy "Members can remove their own workspace membership"
  on public.workspace_members for delete
  using (
    user_id = auth.uid()
    and
    exists (
      select 1
      from public.workspace_members member
      where member.workspace_id = workspace_members.workspace_id
        and member.user_id = auth.uid()
        and member.status = 'active'
    )
  );
