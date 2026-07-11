-- Merge and sync foundation.
--
-- This is intentionally additive. It records staged imports and sync protocol
-- state without enabling automatic import or background synchronization.

create extension if not exists pgcrypto;

create table if not exists public.merge_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  source_device_id text not null,
  source_local_user_id text not null,
  status text not null default 'staged'
    check (status in ('staged', 'committing', 'committed', 'failed', 'rolled_back', 'expired')),
  summary jsonb not null default '{}'::jsonb,
  error_code text,
  committed_at timestamptz,
  rolled_back_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, requested_by, idempotency_key)
);

create index if not exists merge_jobs_workspace_created_idx
  on public.merge_jobs(workspace_id, created_at desc);
create index if not exists merge_jobs_requested_by_created_idx
  on public.merge_jobs(requested_by, created_at desc);

create table if not exists public.merge_job_items (
  id uuid primary key default gen_random_uuid(),
  merge_job_id uuid not null references public.merge_jobs(id) on delete cascade,
  entity_type text not null check (entity_type in ('ideas', 'projects', 'tasks', 'notes')),
  logical_id uuid not null,
  source_record_id uuid not null,
  proposed_action text not null check (proposed_action in ('create', 'update', 'skip', 'conflict')),
  target_record_id uuid,
  source_payload jsonb not null,
  target_snapshot jsonb,
  resolution text check (resolution in ('source_wins', 'target_wins', 'duplicate')),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  unique (merge_job_id, entity_type, logical_id)
);

create index if not exists merge_job_items_job_action_idx
  on public.merge_job_items(merge_job_id, proposed_action);

-- Append-only sync change feed. Cursors are server-issued monotonic values;
-- client timestamps must never be used as a cursor.
create table if not exists public.sync_changes (
  cursor bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in ('ideas', 'projects', 'tasks', 'notes')),
  logical_id uuid not null,
  record_id uuid not null,
  operation text not null check (operation in ('upsert', 'delete')),
  version integer not null check (version > 0),
  payload jsonb,
  changed_by uuid references auth.users(id) on delete set null,
  mutation_id uuid,
  created_at timestamptz not null default now(),
  unique (workspace_id, mutation_id)
);

create index if not exists sync_changes_workspace_cursor_idx
  on public.sync_changes(workspace_id, cursor);

-- Deduplicates retried client writes and preserves their resolved result.
create table if not exists public.sync_mutations (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mutation_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('ideas', 'projects', 'tasks', 'notes')),
  logical_id uuid not null,
  outcome text not null check (outcome in ('applied', 'conflict', 'rejected')),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (workspace_id, mutation_id)
);

alter table public.merge_jobs enable row level security;
alter table public.merge_job_items enable row level security;
alter table public.sync_changes enable row level security;
alter table public.sync_mutations enable row level security;

create policy "workspace editors create merge jobs"
  on public.merge_jobs for insert
  with check (requested_by = auth.uid() and public.can_edit_workspace(workspace_id));

create policy "merge job requesters read their jobs"
  on public.merge_jobs for select
  using (requested_by = auth.uid());

create policy "merge job requesters read their staged items"
  on public.merge_job_items for select
  using (
    exists (
      select 1 from public.merge_jobs job
      where job.id = merge_job_items.merge_job_id
        and job.requested_by = auth.uid()
    )
  );

create policy "workspace members read sync changes"
  on public.sync_changes for select
  using (public.is_workspace_member(workspace_id));

create policy "mutation requesters read sync mutation outcomes"
  on public.sync_mutations for select
  using (requested_by = auth.uid());

drop trigger if exists merge_jobs_updated_at on public.merge_jobs;
create trigger merge_jobs_updated_at before update on public.merge_jobs
  for each row execute function public.set_updated_at_now();

-- Backfill in batches before enabling NOT NULL and unique indexes. This avoids
-- a long table lock and makes the operation resumable after interruptions.
create or replace function public.backfill_logical_ids(batch_size integer default 500)
returns table (table_name text, updated_rows integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer;
begin
  if batch_size < 1 or batch_size > 10000 then
    raise exception 'batch_size must be between 1 and 10000';
  end if;

  with batch as (
    select id from public.ideas where logical_id is null limit batch_size
  )
  update public.ideas item set logical_id = item.id from batch where item.id = batch.id;
  get diagnostics changed = row_count;
  table_name := 'ideas'; updated_rows := changed; return next;

  with batch as (
    select id from public.projects where logical_id is null limit batch_size
  )
  update public.projects item set logical_id = item.id from batch where item.id = batch.id;
  get diagnostics changed = row_count;
  table_name := 'projects'; updated_rows := changed; return next;

  with batch as (
    select id from public.tasks where logical_id is null limit batch_size
  )
  update public.tasks item set logical_id = item.id from batch where item.id = batch.id;
  get diagnostics changed = row_count;
  table_name := 'tasks'; updated_rows := changed; return next;

  with batch as (
    select id from public.notes where logical_id is null limit batch_size
  )
  update public.notes item set logical_id = item.id from batch where item.id = batch.id;
  get diagnostics changed = row_count;
  table_name := 'notes'; updated_rows := changed; return next;
end;
$$;

revoke all on function public.backfill_logical_ids(integer) from public;
grant execute on function public.backfill_logical_ids(integer) to service_role;
