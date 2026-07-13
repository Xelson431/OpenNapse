-- Fresh-install fix for the workspace owner-invariant trigger.
-- Forward-only: replaces enforce_workspace_owner_invariant from 20260711050000.
--
-- The prior version resolved the target workspace id with a single CASE
-- expression referencing both new.id (workspaces) and new.workspace_id
-- (workspace_members). plpgsql prepares that whole expression against the
-- firing row's actual type, so on a `workspaces` row it fails to resolve
-- new.workspace_id: "record \"new\" has no field \"workspace_id\"". This broke
-- the very first create_workspace call on a clean migration chain (fresh
-- self-host / CI), where the deferred trigger fires on a workspaces row.
--
-- Procedural IF/ELSE compiles each branch lazily, so the field reference is
-- only resolved for the table that actually fired. Behavior is otherwise
-- identical to the original invariant.

create or replace function public.enforce_workspace_owner_invariant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_workspace_id uuid;
  recorded_owner uuid;
  owner_count integer;
  matching_count integer;
begin
  if tg_table_name = 'workspaces' then
    target_workspace_id := coalesce(new.id, old.id);
  else
    target_workspace_id := coalesce(new.workspace_id, old.workspace_id);
  end if;

  select owner_user_id into recorded_owner
    from public.workspaces
   where id = target_workspace_id;

  if not found then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  select count(*), count(*) filter (where user_id = recorded_owner)
    into owner_count, matching_count
    from public.workspace_members
   where workspace_id = target_workspace_id
     and role = 'owner'
     and status = 'active';

  if owner_count <> 1 or matching_count <> 1 then
    raise exception 'workspace must have exactly one active owner matching owner_user_id';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
