-- Bounded sync recovery. Operators may compact the change feed only after
-- advancing the workspace cursor floor and retaining an authoritative snapshot.

create table if not exists public.sync_workspace_state (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  cursor_floor bigint not null default 0 check (cursor_floor >= 0),
  retention_days integer not null default 90 check (retention_days between 30 and 365),
  updated_at timestamptz not null default now()
);
alter table public.sync_workspace_state enable row level security;
create policy "workspace members read sync recovery state" on public.sync_workspace_state for select using(public.is_workspace_member(workspace_id));

drop function if exists public.pull_sync_changes(uuid,bigint,integer);
create function public.pull_sync_changes(
  target_workspace_id uuid,
  after_cursor bigint default 0,
  max_changes integer default 100
)
returns table (cursor bigint,entity_type text,logical_id uuid,record_id uuid,operation text,version integer,payload jsonb,changed_at timestamptz,cursor_floor bigint,resnapshot_required boolean)
language sql stable security invoker set search_path=public as $$
  with state as (select coalesce((select s.cursor_floor from public.sync_workspace_state s where s.workspace_id=target_workspace_id),0) floor)
  select change.cursor,change.entity_type,change.logical_id,change.record_id,change.operation,change.version,change.payload,change.created_at,state.floor,after_cursor<state.floor
  from state left join public.sync_changes change on change.workspace_id=target_workspace_id and change.cursor>greatest(after_cursor,state.floor)
  where public.is_workspace_member(target_workspace_id)
  order by change.cursor asc nulls last limit least(greatest(max_changes,1),500)
$$;

create or replace function public.get_workspace_snapshot(target_workspace_id uuid, entity text, after_logical_id uuid default null, page_size integer default 200)
returns table (entity_type text,logical_id uuid,record_id uuid,version integer,payload jsonb,next_logical_id uuid)
language plpgsql stable security invoker set search_path=public as $$
begin
  if not public.is_workspace_member(target_workspace_id) then raise exception 'workspace membership required' using errcode='42501'; end if;
  if entity not in ('projects','ideas','tasks','notes') then raise exception 'invalid snapshot entity'; end if;
  return query execute format(
    'select %L::text,row.logical_id,row.id,row.version,to_jsonb(row),row.logical_id from public.%I row where row.workspace_id=$1 and row.logical_id is not null and ($2 is null or row.logical_id>$2) order by row.logical_id limit $3',entity,entity)
    using target_workspace_id,after_logical_id,least(greatest(page_size,1),500);
end;
$$;

revoke all on function public.pull_sync_changes(uuid,bigint,integer) from public;
revoke all on function public.get_workspace_snapshot(uuid,text,uuid,integer) from public;
grant execute on function public.pull_sync_changes(uuid,bigint,integer) to authenticated;
grant execute on function public.get_workspace_snapshot(uuid,text,uuid,integer) to authenticated;
