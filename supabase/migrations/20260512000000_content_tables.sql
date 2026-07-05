-- OpenNapse content tables (workspace-scoped).
-- Applies after 20260509000000_workspace_foundation.sql.
-- Introduces cloud storage for ideas, projects, tasks, notes with
-- deny-by-default RLS that requires active workspace membership.

create extension if not exists pgcrypto;

-- Helper: is caller an active member of the workspace?
create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security invoker
as $$
  select exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = target_workspace_id
      and member.user_id = auth.uid()
      and member.status = 'active'
  );
$$;

-- Helper: does caller have at least editor-level role in the workspace?
create or replace function public.can_edit_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security invoker
as $$
  select exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = target_workspace_id
      and member.user_id = auth.uid()
      and member.status = 'active'
      and member.role in ('owner', 'admin', 'member')
  );
$$;

-- =========================================================================
-- projects
-- =========================================================================
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null,
  description text not null default '',
  source_idea_id uuid,
  why_now text not null,
  first_step text not null,
  done_looks_like text not null,
  status text not null default 'planning' check (status in ('planning', 'active', 'paused', 'shipped', 'abandoned')),
  color text not null default '#78716C',
  version integer not null default 1 check (version > 0),
  client_id text not null,
  device_id text not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_workspace_idx on public.projects(workspace_id);
create index if not exists projects_workspace_updated_idx on public.projects(workspace_id, updated_at desc);
alter table public.projects enable row level security;

create policy "workspace members read projects"
  on public.projects for select
  using (public.is_workspace_member(workspace_id));

create policy "workspace editors insert projects"
  on public.projects for insert
  with check (
    public.can_edit_workspace(workspace_id)
    and created_by = auth.uid()
  );

create policy "workspace editors update projects"
  on public.projects for update
  using (public.can_edit_workspace(workspace_id))
  with check (public.can_edit_workspace(workspace_id));

create policy "workspace editors soft-delete projects"
  on public.projects for delete
  using (public.can_edit_workspace(workspace_id));

-- =========================================================================
-- ideas
-- =========================================================================
create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  body text not null default '',
  status text not null default 'raw' check (status in ('raw', 'active', 'project', 'done', 'buried')),
  tags text[] not null default '{}'::text[],
  color text not null default '#78716C',
  energy_level integer check (energy_level is null or (energy_level between 1 and 5)),
  mood text check (mood is null or mood in ('focused', 'creative', 'anxious', 'energetic', 'tired')),
  last_touched_at timestamptz not null default now(),
  buried_at timestamptz,
  version integer not null default 1 check (version > 0),
  client_id text not null,
  device_id text not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ideas_workspace_idx on public.ideas(workspace_id);
create index if not exists ideas_workspace_updated_idx on public.ideas(workspace_id, updated_at desc);
create index if not exists ideas_workspace_project_idx on public.ideas(workspace_id, project_id);
alter table public.ideas enable row level security;

create policy "workspace members read ideas"
  on public.ideas for select
  using (public.is_workspace_member(workspace_id));

create policy "workspace editors insert ideas"
  on public.ideas for insert
  with check (
    public.can_edit_workspace(workspace_id)
    and created_by = auth.uid()
  );

create policy "workspace editors update ideas"
  on public.ideas for update
  using (public.can_edit_workspace(workspace_id))
  with check (public.can_edit_workspace(workspace_id));

create policy "workspace editors delete ideas"
  on public.ideas for delete
  using (public.can_edit_workspace(workspace_id));

-- =========================================================================
-- tasks
-- =========================================================================
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete cascade,
  idea_id uuid references public.ideas(id) on delete set null,
  title text not null,
  description text not null default '',
  column_id text not null default 'backlog' check (column_id in ('backlog', 'todo', 'in_progress', 'review', 'done')),
  sort_order double precision not null default 0,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  scheduled_date date,
  due_date date,
  completion_pct integer not null default 0 check (completion_pct between 0 and 100),
  completed_at timestamptz,
  version integer not null default 1 check (version > 0),
  client_id text not null,
  device_id text not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_workspace_idx on public.tasks(workspace_id);
create index if not exists tasks_workspace_project_idx on public.tasks(workspace_id, project_id);
create index if not exists tasks_workspace_updated_idx on public.tasks(workspace_id, updated_at desc);
create index if not exists tasks_workspace_scheduled_idx on public.tasks(workspace_id, scheduled_date) where scheduled_date is not null;
create index if not exists tasks_workspace_due_idx on public.tasks(workspace_id, due_date) where due_date is not null;
alter table public.tasks enable row level security;

create policy "workspace members read tasks"
  on public.tasks for select
  using (public.is_workspace_member(workspace_id));

create policy "workspace editors insert tasks"
  on public.tasks for insert
  with check (
    public.can_edit_workspace(workspace_id)
    and created_by = auth.uid()
  );

create policy "workspace editors update tasks"
  on public.tasks for update
  using (public.can_edit_workspace(workspace_id))
  with check (public.can_edit_workspace(workspace_id));

create policy "workspace editors delete tasks"
  on public.tasks for delete
  using (public.can_edit_workspace(workspace_id));

-- =========================================================================
-- notes
-- =========================================================================
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  linked_project_id uuid references public.projects(id) on delete set null,
  linked_idea_id uuid references public.ideas(id) on delete set null,
  title text not null,
  content text not null default '',
  tags text[] not null default '{}'::text[],
  color text not null default '#78716C',
  voice_recordings jsonb not null default '[]'::jsonb,
  version integer not null default 1 check (version > 0),
  client_id text not null,
  device_id text not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_workspace_idx on public.notes(workspace_id);
create index if not exists notes_workspace_updated_idx on public.notes(workspace_id, updated_at desc);
create index if not exists notes_workspace_project_idx on public.notes(workspace_id, linked_project_id);
alter table public.notes enable row level security;

create policy "workspace members read notes"
  on public.notes for select
  using (public.is_workspace_member(workspace_id));

create policy "workspace editors insert notes"
  on public.notes for insert
  with check (
    public.can_edit_workspace(workspace_id)
    and created_by = auth.uid()
  );

create policy "workspace editors update notes"
  on public.notes for update
  using (public.can_edit_workspace(workspace_id))
  with check (public.can_edit_workspace(workspace_id));

create policy "workspace editors delete notes"
  on public.notes for delete
  using (public.can_edit_workspace(workspace_id));

-- updated_at trigger helper
create or replace function public.set_updated_at_now()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at_now();

drop trigger if exists ideas_updated_at on public.ideas;
create trigger ideas_updated_at before update on public.ideas
  for each row execute function public.set_updated_at_now();

drop trigger if exists tasks_updated_at on public.tasks;
create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at_now();

drop trigger if exists notes_updated_at on public.notes;
create trigger notes_updated_at before update on public.notes
  for each row execute function public.set_updated_at_now();
