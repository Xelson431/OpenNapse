-- Idea descriptions and linked resources.
-- Adds a longer-form markdown `description` to ideas (distinct from the short
-- `body` capture field) and an `idea_resources` table for markdown docs/links
-- attached to an idea. Both are workspace-scoped and RLS-gated so agents (via
-- the MCP server acting as the signed-in user) only reach their own data.

alter table public.ideas
  add column if not exists description text not null default '';

-- =========================================================================
-- idea_resources — markdown docs / links attached to an idea
-- =========================================================================
create table if not exists public.idea_resources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null,
  kind text not null default 'markdown' check (kind in ('markdown', 'link')),
  content text not null default '',
  url text,
  sort_order double precision not null default 0,
  version integer not null default 1 check (version > 0),
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'markdown')
    or (kind = 'link' and url is not null)
  )
);

create index if not exists idea_resources_workspace_idx on public.idea_resources(workspace_id);
create index if not exists idea_resources_idea_idx on public.idea_resources(idea_id);
alter table public.idea_resources enable row level security;

create policy "workspace members read idea resources"
  on public.idea_resources for select
  using (public.is_workspace_member(workspace_id));

create policy "workspace editors insert idea resources"
  on public.idea_resources for insert
  with check (
    public.can_edit_workspace(workspace_id)
    and created_by = auth.uid()
  );

create policy "workspace editors update idea resources"
  on public.idea_resources for update
  using (public.can_edit_workspace(workspace_id))
  with check (public.can_edit_workspace(workspace_id));

create policy "workspace editors delete idea resources"
  on public.idea_resources for delete
  using (public.can_edit_workspace(workspace_id));

drop trigger if exists idea_resources_updated_at on public.idea_resources;
create trigger idea_resources_updated_at before update on public.idea_resources
  for each row execute function public.set_updated_at_now();

-- Keep a resource in the same workspace as its idea. Mirrors the cross-workspace
-- reference guard used for other content in 20260711060000.
create or replace function public.enforce_idea_resource_workspace()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.ideas
    where id = new.idea_id and workspace_id = new.workspace_id
  ) then
    raise exception 'idea resource must belong to the same workspace as its idea';
  end if;
  return new;
end;
$$;

drop trigger if exists idea_resources_workspace_guard on public.idea_resources;
create trigger idea_resources_workspace_guard before insert or update on public.idea_resources
  for each row execute function public.enforce_idea_resource_workspace();
