-- Server-authoritative sync mutation application and content invariants.

create or replace function public.enforce_content_identity_immutable()
returns trigger language plpgsql as $$
begin
  if new.workspace_id is distinct from old.workspace_id
     or new.created_by is distinct from old.created_by
     or new.logical_id is distinct from old.logical_id then
    raise exception 'workspace_id, created_by, and logical_id are immutable';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_content_workspace_references()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'projects' and new.source_idea_id is not null
     and not exists (select 1 from public.ideas where id = new.source_idea_id and workspace_id = new.workspace_id) then
    raise exception 'project source idea must belong to the same workspace';
  elsif tg_table_name = 'ideas' and new.project_id is not null
     and not exists (select 1 from public.projects where id = new.project_id and workspace_id = new.workspace_id) then
    raise exception 'idea project must belong to the same workspace';
  elsif tg_table_name = 'tasks' then
    if not exists (select 1 from public.projects where id = new.project_id and workspace_id = new.workspace_id) then
      raise exception 'task project must belong to the same workspace';
    end if;
    if new.idea_id is not null and not exists (select 1 from public.ideas where id = new.idea_id and workspace_id = new.workspace_id) then
      raise exception 'task idea must belong to the same workspace';
    end if;
  elsif tg_table_name = 'notes' then
    if new.linked_project_id is not null and not exists (select 1 from public.projects where id = new.linked_project_id and workspace_id = new.workspace_id) then
      raise exception 'note project must belong to the same workspace';
    end if;
    if new.linked_idea_id is not null and not exists (select 1 from public.ideas where id = new.linked_idea_id and workspace_id = new.workspace_id) then
      raise exception 'note idea must belong to the same workspace';
    end if;
  end if;
  return new;
end;
$$;

do $$ declare table_name text; begin
  foreach table_name in array array['ideas','projects','tasks','notes'] loop
    execute format('drop trigger if exists %I on public.%I', table_name||'_identity_immutable', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.enforce_content_identity_immutable()', table_name||'_identity_immutable', table_name);
    execute format('drop trigger if exists %I on public.%I', table_name||'_workspace_references', table_name);
    execute format('create trigger %I after insert or update on public.%I for each row execute function public.enforce_content_workspace_references()', table_name||'_workspace_references', table_name);
  end loop;
end $$;

create or replace function public.apply_sync_mutations(target_workspace_id uuid, mutations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  mutation jsonb;
  mutation_uuid uuid;
  entity text;
  logical_uuid uuid;
  operation_name text;
  expected integer;
  body jsonb;
  existing_result jsonb;
  current_id uuid;
  current_version integer;
  result_rows jsonb := '[]'::jsonb;
  resolved_payload jsonb;
  resolved_version integer;
begin
  if caller is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not public.can_edit_workspace(target_workspace_id) then raise exception 'workspace edit permission required' using errcode = '42501'; end if;
  if jsonb_typeof(mutations) <> 'array' or jsonb_array_length(mutations) > 100 then
    raise exception 'mutations must be an array of at most 100 items';
  end if;

  for mutation in select value from jsonb_array_elements(mutations) loop
    begin
      mutation_uuid := (mutation->>'mutationId')::uuid;
      entity := mutation->>'entityType';
      logical_uuid := (mutation->>'logicalId')::uuid;
      operation_name := mutation->>'operation';
      expected := greatest(coalesce((mutation->>'expectedVersion')::integer, 0), 0);
      body := coalesce(mutation->'payload', '{}'::jsonb);
      if entity not in ('ideas','projects','tasks','notes') or operation_name not in ('upsert','delete') then
        raise exception 'invalid mutation entity or operation';
      end if;

      select result into existing_result from public.sync_mutations
       where workspace_id = target_workspace_id and mutation_id = mutation_uuid;
      if found then
        result_rows := result_rows || jsonb_build_array(existing_result);
        continue;
      end if;

      execute format('select id, version from public.%I where workspace_id = $1 and logical_id = $2 for update', entity)
        into current_id, current_version using target_workspace_id, logical_uuid;

      if current_id is not null and current_version <> expected then
        resolved_payload := jsonb_build_object('mutationId', mutation_uuid, 'outcome', 'conflict', 'logicalId', logical_uuid, 'serverVersion', current_version);
        insert into public.sync_mutations(workspace_id, mutation_id, requested_by, entity_type, logical_id, outcome, result)
        values (target_workspace_id, mutation_uuid, caller, entity, logical_uuid, 'conflict', resolved_payload);
        result_rows := result_rows || jsonb_build_array(resolved_payload);
        continue;
      end if;
      if current_id is null and expected <> 0 then
        resolved_payload := jsonb_build_object('mutationId', mutation_uuid, 'outcome', 'conflict', 'logicalId', logical_uuid, 'serverVersion', 0);
        insert into public.sync_mutations(workspace_id, mutation_id, requested_by, entity_type, logical_id, outcome, result)
        values (target_workspace_id, mutation_uuid, caller, entity, logical_uuid, 'conflict', resolved_payload);
        result_rows := result_rows || jsonb_build_array(resolved_payload);
        continue;
      end if;

      resolved_version := coalesce(current_version, 0) + 1;
      if entity = 'ideas' then
        insert into public.ideas(id, logical_id, workspace_id, created_by, project_id, title, body, status, tags, color, energy_level, mood, last_touched_at, buried_at, version, client_id, device_id, is_deleted, created_at)
        values (coalesce(current_id, gen_random_uuid()), logical_uuid, target_workspace_id, caller,
          nullif(body->>'projectId','')::uuid, left(coalesce(body->>'title',''),180), left(coalesce(body->>'body',''),10000), coalesce(body->>'status','raw'),
          coalesce(array(select jsonb_array_elements_text(coalesce(body->'tags','[]'::jsonb))), '{}'::text[]), coalesce(body->>'color','#78716C'),
          nullif(body->>'energyLevel','')::integer, nullif(body->>'mood',''), coalesce(nullif(body->>'lastTouchedAt','')::timestamptz,now()), nullif(body->>'buriedAt','')::timestamptz,
          resolved_version, coalesce(body->>'clientId',mutation_uuid::text), coalesce(body->>'deviceId','sync'), operation_name='delete', coalesce(nullif(body->>'createdAt','')::timestamptz,now()))
        on conflict (id) do update set project_id=excluded.project_id,title=excluded.title,body=excluded.body,status=excluded.status,tags=excluded.tags,color=excluded.color,energy_level=excluded.energy_level,mood=excluded.mood,last_touched_at=excluded.last_touched_at,buried_at=excluded.buried_at,version=excluded.version,client_id=excluded.client_id,device_id=excluded.device_id,is_deleted=excluded.is_deleted;
      elsif entity = 'projects' then
        insert into public.projects(id, logical_id, workspace_id, created_by, title, description, source_idea_id, why_now, first_step, done_looks_like, status, color, version, client_id, device_id, is_deleted, created_at)
        values (coalesce(current_id, gen_random_uuid()), logical_uuid, target_workspace_id, caller, left(coalesce(body->>'title',''),180), left(coalesce(body->>'description',''),10000), nullif(body->>'sourceIdeaId','')::uuid, left(coalesce(body->>'whyNow',''),5000), left(coalesce(body->>'firstStep',''),5000), left(coalesce(body->>'doneLooksLike',''),5000), coalesce(body->>'status','planning'), coalesce(body->>'color','#78716C'), resolved_version, coalesce(body->>'clientId',mutation_uuid::text), coalesce(body->>'deviceId','sync'), operation_name='delete', coalesce(nullif(body->>'createdAt','')::timestamptz,now()))
        on conflict (id) do update set title=excluded.title,description=excluded.description,source_idea_id=excluded.source_idea_id,why_now=excluded.why_now,first_step=excluded.first_step,done_looks_like=excluded.done_looks_like,status=excluded.status,color=excluded.color,version=excluded.version,client_id=excluded.client_id,device_id=excluded.device_id,is_deleted=excluded.is_deleted;
      elsif entity = 'tasks' then
        insert into public.tasks(id, logical_id, workspace_id, created_by, project_id, idea_id, title, description, column_id, sort_order, priority, scheduled_date, due_date, completion_pct, completed_at, version, client_id, device_id, is_deleted, created_at)
        values (coalesce(current_id, gen_random_uuid()), logical_uuid, target_workspace_id, caller, (body->>'projectId')::uuid, nullif(body->>'ideaId','')::uuid, left(coalesce(body->>'title',''),180), left(coalesce(body->>'description',''),10000), coalesce(body->>'columnId','backlog'), coalesce((body->>'sortOrder')::double precision,0), coalesce(body->>'priority','medium'), nullif(body->>'scheduledDate','')::date, nullif(body->>'dueDate','')::date, coalesce((body->>'completionPct')::integer,0), nullif(body->>'completedAt','')::timestamptz, resolved_version, coalesce(body->>'clientId',mutation_uuid::text), coalesce(body->>'deviceId','sync'), operation_name='delete', coalesce(nullif(body->>'createdAt','')::timestamptz,now()))
        on conflict (id) do update set project_id=excluded.project_id,idea_id=excluded.idea_id,title=excluded.title,description=excluded.description,column_id=excluded.column_id,sort_order=excluded.sort_order,priority=excluded.priority,scheduled_date=excluded.scheduled_date,due_date=excluded.due_date,completion_pct=excluded.completion_pct,completed_at=excluded.completed_at,version=excluded.version,client_id=excluded.client_id,device_id=excluded.device_id,is_deleted=excluded.is_deleted;
      else
        insert into public.notes(id, logical_id, workspace_id, created_by, linked_project_id, linked_idea_id, title, content, tags, color, voice_recordings, version, client_id, device_id, is_deleted, created_at)
        values (coalesce(current_id, gen_random_uuid()), logical_uuid, target_workspace_id, caller, nullif(body->>'linkedProjectId','')::uuid, nullif(body->>'linkedIdeaId','')::uuid, left(coalesce(body->>'title',''),180), left(coalesce(body->>'content',''),50000), coalesce(array(select jsonb_array_elements_text(coalesce(body->'tags','[]'::jsonb))), '{}'::text[]), coalesce(body->>'color','#78716C'), coalesce(body->'voiceRecordings','[]'::jsonb), resolved_version, coalesce(body->>'clientId',mutation_uuid::text), coalesce(body->>'deviceId','sync'), operation_name='delete', coalesce(nullif(body->>'createdAt','')::timestamptz,now()))
        on conflict (id) do update set linked_project_id=excluded.linked_project_id,linked_idea_id=excluded.linked_idea_id,title=excluded.title,content=excluded.content,tags=excluded.tags,color=excluded.color,voice_recordings=excluded.voice_recordings,version=excluded.version,client_id=excluded.client_id,device_id=excluded.device_id,is_deleted=excluded.is_deleted;
      end if;

      execute format('select to_jsonb(row) from public.%I row where workspace_id = $1 and logical_id = $2', entity)
        into resolved_payload using target_workspace_id, logical_uuid;
      insert into public.sync_changes(workspace_id, entity_type, logical_id, record_id, operation, version, payload, changed_by, mutation_id)
      values (target_workspace_id, entity, logical_uuid, (resolved_payload->>'id')::uuid, operation_name, resolved_version, resolved_payload, caller, mutation_uuid);
      resolved_payload := jsonb_build_object('mutationId',mutation_uuid,'outcome','applied','logicalId',logical_uuid,'recordId',resolved_payload->>'id','version',resolved_version);
      insert into public.sync_mutations(workspace_id, mutation_id, requested_by, entity_type, logical_id, outcome, result)
      values (target_workspace_id, mutation_uuid, caller, entity, logical_uuid, 'applied', resolved_payload);
      result_rows := result_rows || jsonb_build_array(resolved_payload);
    exception when others then
      resolved_payload := jsonb_build_object('mutationId',coalesce(mutation->>'mutationId',''),'outcome','rejected','error',sqlerrm);
      if mutation_uuid is not null and logical_uuid is not null and entity in ('ideas','projects','tasks','notes') then
        insert into public.sync_mutations(workspace_id, mutation_id, requested_by, entity_type, logical_id, outcome, result)
        values (target_workspace_id, mutation_uuid, caller, entity, logical_uuid, 'rejected', resolved_payload)
        on conflict do nothing;
      end if;
      result_rows := result_rows || jsonb_build_array(resolved_payload);
    end;
    current_id := null; current_version := null; mutation_uuid := null; logical_uuid := null;
  end loop;
  return result_rows;
end;
$$;

revoke all on function public.apply_sync_mutations(uuid, jsonb) from public;
grant execute on function public.apply_sync_mutations(uuid, jsonb) to authenticated;
