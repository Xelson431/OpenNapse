-- Task attribution for collaborative workspaces.
-- Adds who last edited a task and who it's assigned to. Both nullable and
-- additive so existing rows and self-host/local flows are unaffected.

alter table public.tasks
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

alter table public.tasks
  add column if not exists assignee_id uuid references auth.users(id) on delete set null;

create index if not exists tasks_workspace_assignee_idx
  on public.tasks(workspace_id, assignee_id) where assignee_id is not null;

-- An assignee must be an active member of the task's workspace. Enforced
-- server-side so application code is not the boundary.
create or replace function public.enforce_task_assignee_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assignee_id is not null
     and not exists (
       select 1 from public.workspace_members m
       where m.workspace_id = new.workspace_id
         and m.user_id = new.assignee_id
         and m.status = 'active'
     ) then
    raise exception 'task assignee must be an active member of the workspace';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_assignee_membership on public.tasks;
create trigger tasks_assignee_membership before insert or update on public.tasks
  for each row execute function public.enforce_task_assignee_membership();
