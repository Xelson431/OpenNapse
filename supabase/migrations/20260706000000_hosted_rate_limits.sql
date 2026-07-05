-- OpenNapse hosted write rate limits.
-- Applies after content tables. This is defensive server-side protection for
-- direct Supabase REST writes; client-side throttles are only UX helpers.

create extension if not exists pgcrypto;

create table if not exists public.rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  operation text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_events_user_op_created_idx
  on public.rate_limit_events(user_id, operation, created_at desc);
create index if not exists rate_limit_events_workspace_created_idx
  on public.rate_limit_events(workspace_id, created_at desc);

alter table public.rate_limit_events enable row level security;

-- No client policies. Events are inserted by SECURITY DEFINER trigger function.

create or replace function public.hosted_write_limit_for(operation_name text)
returns integer
language sql
stable
as $$
  select case
    when operation_name in ('notes:insert', 'notes:update') then 240
    when operation_name in ('ideas:insert', 'ideas:update') then 180
    when operation_name in ('tasks:insert', 'tasks:update') then 180
    when operation_name in ('projects:insert', 'projects:update') then 120
    when operation_name like '%:delete' then 120
    else 120
  end;
$$;

create or replace function public.enforce_hosted_write_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  target_workspace uuid;
  operation_name text := TG_TABLE_NAME || ':' || lower(TG_OP);
  max_events integer;
  recent_events integer;
begin
  -- Service-role/server-side maintenance has no caller JWT and bypasses this
  -- user-facing throttle. RLS still guards normal browser writes before here.
  if caller is null then
    if TG_OP = 'DELETE' then
      return OLD;
    end if;
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    target_workspace := OLD.workspace_id;
  else
    target_workspace := NEW.workspace_id;
  end if;

  max_events := public.hosted_write_limit_for(operation_name);

  select count(*)
    into recent_events
    from public.rate_limit_events event
   where event.user_id = caller
     and event.operation = operation_name
     and event.created_at > now() - interval '1 minute';

  if recent_events >= max_events then
    raise exception 'OpenNapse write rate limit exceeded for %', operation_name
      using errcode = 'P0001';
  end if;

  insert into public.rate_limit_events(user_id, workspace_id, operation)
  values (caller, target_workspace, operation_name);

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

drop trigger if exists projects_hosted_write_rate_limit on public.projects;
create trigger projects_hosted_write_rate_limit
  before insert or update or delete on public.projects
  for each row execute function public.enforce_hosted_write_rate_limit();

drop trigger if exists ideas_hosted_write_rate_limit on public.ideas;
create trigger ideas_hosted_write_rate_limit
  before insert or update or delete on public.ideas
  for each row execute function public.enforce_hosted_write_rate_limit();

drop trigger if exists tasks_hosted_write_rate_limit on public.tasks;
create trigger tasks_hosted_write_rate_limit
  before insert or update or delete on public.tasks
  for each row execute function public.enforce_hosted_write_rate_limit();

drop trigger if exists notes_hosted_write_rate_limit on public.notes;
create trigger notes_hosted_write_rate_limit
  before insert or update or delete on public.notes
  for each row execute function public.enforce_hosted_write_rate_limit();
