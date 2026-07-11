-- MANUAL TEMPLATE — do not move into migrations until dual-write adoption,
-- backfill, and collision reports are all clean.
do $$
declare table_name text; nulls_remaining bigint; duplicate_groups bigint;
begin
  foreach table_name in array array['ideas','projects','tasks','notes'] loop
    execute format('select count(*) from public.%I where logical_id is null',table_name) into nulls_remaining;
    execute format('select count(*) from (select workspace_id,logical_id from public.%I group by workspace_id,logical_id having count(*)>1) duplicates',table_name) into duplicate_groups;
    if nulls_remaining>0 or duplicate_groups>0 then raise exception '% is not ready: % null IDs, % duplicate groups',table_name,nulls_remaining,duplicate_groups; end if;
  end loop;
end $$;

create unique index concurrently if not exists ideas_workspace_logical_id_uidx on public.ideas(workspace_id,logical_id);
create unique index concurrently if not exists projects_workspace_logical_id_uidx on public.projects(workspace_id,logical_id);
create unique index concurrently if not exists tasks_workspace_logical_id_uidx on public.tasks(workspace_id,logical_id);
create unique index concurrently if not exists notes_workspace_logical_id_uidx on public.notes(workspace_id,logical_id);

alter table public.ideas alter column logical_id set not null;
alter table public.projects alter column logical_id set not null;
alter table public.tasks alter column logical_id set not null;
alter table public.notes alter column logical_id set not null;

