-- Add lightweight day-planning metadata to tasks.
-- Keep dates nullable so the Kanban remains the source of workflow truth;
-- only tasks explicitly planned for a day or carrying a deadline appear in
-- calendar/today-style surfaces.

alter table public.tasks
  add column if not exists scheduled_date date,
  add column if not exists due_date date;

create index if not exists tasks_workspace_scheduled_idx
  on public.tasks(workspace_id, scheduled_date)
  where scheduled_date is not null;

create index if not exists tasks_workspace_due_idx
  on public.tasks(workspace_id, due_date)
  where due_date is not null;
