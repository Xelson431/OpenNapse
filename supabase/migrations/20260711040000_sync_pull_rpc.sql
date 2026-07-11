-- Read-only cursor pull API for sync clients. It is intentionally separate
-- from mutation application so a failed push can never corrupt pull recovery.

create or replace function public.pull_sync_changes(
  target_workspace_id uuid,
  after_cursor bigint default 0,
  max_changes integer default 100
)
returns table (
  cursor bigint,
  entity_type text,
  logical_id uuid,
  record_id uuid,
  operation text,
  version integer,
  payload jsonb,
  changed_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    change.cursor,
    change.entity_type,
    change.logical_id,
    change.record_id,
    change.operation,
    change.version,
    change.payload,
    change.created_at
  from public.sync_changes change
  where change.workspace_id = target_workspace_id
    and change.cursor > greatest(after_cursor, 0)
  order by change.cursor asc
  limit least(greatest(max_changes, 1), 500)
$$;

revoke all on function public.pull_sync_changes(uuid, bigint, integer) from public;
grant execute on function public.pull_sync_changes(uuid, bigint, integer) to authenticated;
