-- Server-authoritative staged merge workflow.

alter table public.merge_job_items add column if not exists applied_version integer;

create or replace function public.sync_payload_from_row(entity text, row_data jsonb)
returns jsonb language sql immutable as $$
  select case entity
    when 'ideas' then jsonb_build_object('projectId',row_data->>'project_id','title',row_data->>'title','body',row_data->>'body','status',row_data->>'status','tags',row_data->'tags','color',row_data->>'color','energyLevel',row_data->'energy_level','mood',row_data->'mood','lastTouchedAt',row_data->>'last_touched_at','buriedAt',row_data->>'buried_at','clientId',row_data->>'client_id','deviceId',row_data->>'device_id','createdAt',row_data->>'created_at')
    when 'projects' then jsonb_build_object('title',row_data->>'title','description',row_data->>'description','sourceIdeaId',row_data->>'source_idea_id','whyNow',row_data->>'why_now','firstStep',row_data->>'first_step','doneLooksLike',row_data->>'done_looks_like','status',row_data->>'status','color',row_data->>'color','clientId',row_data->>'client_id','deviceId',row_data->>'device_id','createdAt',row_data->>'created_at')
    when 'tasks' then jsonb_build_object('projectId',row_data->>'project_id','ideaId',row_data->>'idea_id','title',row_data->>'title','description',row_data->>'description','columnId',row_data->>'column_id','sortOrder',row_data->'sort_order','priority',row_data->>'priority','scheduledDate',row_data->>'scheduled_date','dueDate',row_data->>'due_date','completionPct',row_data->'completion_pct','completedAt',row_data->>'completed_at','clientId',row_data->>'client_id','deviceId',row_data->>'device_id','createdAt',row_data->>'created_at')
    when 'notes' then jsonb_build_object('linkedProjectId',row_data->>'linked_project_id','linkedIdeaId',row_data->>'linked_idea_id','title',row_data->>'title','content',row_data->>'content','tags',row_data->'tags','color',row_data->>'color','voiceRecordings',row_data->'voice_recordings','clientId',row_data->>'client_id','deviceId',row_data->>'device_id','createdAt',row_data->>'created_at')
    else '{}'::jsonb end;
$$;

create or replace function public.stage_merge_export(
  target_workspace_id uuid,
  idempotency_key uuid,
  exported_data jsonb
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare caller uuid := auth.uid(); job_id uuid; entity text; source jsonb; logical uuid; source_id uuid; target_id uuid; source_version integer; target_version integer; target_updated timestamptz; target_snapshot jsonb; action text; item_count integer := 0;
begin
  if caller is null then raise exception 'authentication required' using errcode='28000'; end if;
  if not public.can_edit_workspace(target_workspace_id) then raise exception 'workspace edit permission required' using errcode='42501'; end if;
  if coalesce((exported_data->>'exportVersion')::integer,0) <> 2 then raise exception 'export version 2 required'; end if;
  if nullif(exported_data->>'deviceId','') is null or nullif(exported_data->>'localUserId','') is null then raise exception 'export identity is required'; end if;

  select id into job_id from public.merge_jobs where workspace_id=target_workspace_id and requested_by=caller and merge_jobs.idempotency_key=stage_merge_export.idempotency_key;
  if job_id is not null then return job_id; end if;
  insert into public.merge_jobs(workspace_id,requested_by,idempotency_key,source_device_id,source_local_user_id)
  values(target_workspace_id,caller,idempotency_key,exported_data->>'deviceId',exported_data->>'localUserId') returning id into job_id;

  foreach entity in array array['projects','ideas','tasks','notes'] loop
    if jsonb_typeof(coalesce(exported_data->entity,'[]'::jsonb)) <> 'array' then raise exception '% must be an array',entity; end if;
    for source in select value from jsonb_array_elements(coalesce(exported_data->entity,'[]'::jsonb)) loop
      item_count := item_count + 1;
      if item_count > 10000 then raise exception 'export exceeds 10000 records'; end if;
      source_id := (source->>'id')::uuid;
      logical := coalesce(nullif(source->>'logicalId','')::uuid,source_id);
      source_version := greatest(coalesce((source->>'version')::integer,1),1);
      execute format('select id,version,updated_at,to_jsonb(row) from public.%I row where workspace_id=$1 and logical_id=$2',entity)
        into target_id,target_version,target_updated,target_snapshot using target_workspace_id,logical;
      action := case when target_id is null then 'create'
        when source_version > target_version then 'update'
        when source_version < target_version then 'skip'
        when coalesce(source->>'updatedAt','') = target_updated::text then 'skip'
        else 'conflict' end;
      insert into public.merge_job_items(merge_job_id,entity_type,logical_id,source_record_id,proposed_action,target_record_id,source_payload,target_snapshot)
      values(job_id,entity,logical,source_id,action,target_id,source,target_snapshot);
      target_id := null; target_version := null; target_updated := null; target_snapshot := null;
    end loop;
  end loop;
  update public.merge_jobs set summary=jsonb_build_object('total',item_count,'status','preview-ready') where id=job_id;
  insert into public.audit_logs(actor_user_id,workspace_id,action,target_type,target_id,metadata)
  values(caller,target_workspace_id,'merge.staged','merge_job',job_id::text,jsonb_build_object('items',item_count));
  return job_id;
end;
$$;

create or replace function public.resolve_merge_item(target_item_id uuid, chosen_resolution text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if chosen_resolution not in ('source_wins','target_wins','duplicate') then raise exception 'invalid resolution'; end if;
  update public.merge_job_items item set resolution=chosen_resolution
   from public.merge_jobs job where item.id=target_item_id and job.id=item.merge_job_id
     and job.requested_by=auth.uid() and job.status='staged' and item.proposed_action='conflict';
  if not found then raise exception 'merge item not found or not resolvable' using errcode='P0002'; end if;
end;
$$;

create or replace function public.commit_merge(target_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare caller uuid:=auth.uid(); job public.merge_jobs%rowtype; item public.merge_job_items%rowtype; body jsonb; response jsonb; outcome jsonb; mutation_id uuid; effective_logical uuid; target_ref uuid; applied integer:=0; skipped integer:=0;
begin
  select * into job from public.merge_jobs where id=target_job_id and requested_by=caller for update;
  if not found then raise exception 'merge job not found' using errcode='P0002'; end if;
  if job.status='committed' then return job.summary; end if;
  if job.status<>'staged' or job.expires_at<=now() then raise exception 'merge job cannot be committed'; end if;
  if exists(select 1 from public.merge_job_items where merge_job_id=job.id and proposed_action='conflict' and resolution is null) then raise exception 'all conflicts require a resolution'; end if;
  update public.merge_jobs set status='committing' where id=job.id;

  for item in select * from public.merge_job_items where merge_job_id=job.id order by array_position(array['projects','ideas','tasks','notes'],entity_type),created_at loop
    if item.proposed_action='skip' or item.resolution='target_wins' then skipped:=skipped+1; continue; end if;
    body:=item.source_payload;
    -- References are rewritten through the job's source-to-target map. Project
    -- sourceIdeaId is linked in a second pass after ideas exist.
    if item.entity_type='projects' then body:=body-'sourceIdeaId'; end if;
    if item.entity_type='ideas' and nullif(body->>'projectId','') is not null then
      select target_record_id into target_ref from public.merge_job_items where merge_job_id=job.id and source_record_id=(body->>'projectId')::uuid;
      body:=jsonb_set(body,'{projectId}',to_jsonb(target_ref::text));
    elsif item.entity_type='tasks' then
      select target_record_id into target_ref from public.merge_job_items where merge_job_id=job.id and source_record_id=(body->>'projectId')::uuid;
      body:=jsonb_set(body,'{projectId}',to_jsonb(target_ref::text));
      if nullif(body->>'ideaId','') is not null then select target_record_id into target_ref from public.merge_job_items where merge_job_id=job.id and source_record_id=(body->>'ideaId')::uuid; body:=jsonb_set(body,'{ideaId}',to_jsonb(target_ref::text)); end if;
    elsif item.entity_type='notes' then
      if nullif(body->>'linkedProjectId','') is not null then select target_record_id into target_ref from public.merge_job_items where merge_job_id=job.id and source_record_id=(body->>'linkedProjectId')::uuid; body:=jsonb_set(body,'{linkedProjectId}',to_jsonb(target_ref::text)); end if;
      if nullif(body->>'linkedIdeaId','') is not null then select target_record_id into target_ref from public.merge_job_items where merge_job_id=job.id and source_record_id=(body->>'linkedIdeaId')::uuid; body:=jsonb_set(body,'{linkedIdeaId}',to_jsonb(target_ref::text)); end if;
    end if;
    mutation_id:=gen_random_uuid();
    effective_logical:=case when item.resolution='duplicate' then gen_random_uuid() else item.logical_id end;
    response:=public.apply_sync_mutations(job.workspace_id,jsonb_build_array(jsonb_build_object('mutationId',mutation_id,'entityType',item.entity_type,'logicalId',effective_logical,'operation','upsert','expectedVersion',coalesce((item.target_snapshot->>'version')::integer,0),'payload',body)));
    outcome:=response->0;
    if outcome->>'outcome'<>'applied' then raise exception 'merge item % failed: %',item.id,outcome; end if;
    update public.merge_job_items set logical_id=effective_logical,target_record_id=(outcome->>'recordId')::uuid,applied_version=(outcome->>'version')::integer,applied_at=now() where id=item.id;
    applied:=applied+1;
  end loop;

  -- Restore project->source idea links after both entity sets exist.
  for item in select * from public.merge_job_items where merge_job_id=job.id and entity_type='projects' and applied_at is not null and nullif(source_payload->>'sourceIdeaId','') is not null loop
    select target_record_id into target_ref from public.merge_job_items where merge_job_id=job.id and source_record_id=(item.source_payload->>'sourceIdeaId')::uuid;
    if target_ref is not null then
      body:=jsonb_set(item.source_payload,'{sourceIdeaId}',to_jsonb(target_ref::text));
      response:=public.apply_sync_mutations(job.workspace_id,jsonb_build_array(jsonb_build_object('mutationId',gen_random_uuid(),'entityType','projects','logicalId',item.logical_id,'operation','upsert','expectedVersion',item.applied_version,'payload',body)));
      outcome:=response->0;
      if outcome->>'outcome'<>'applied' then raise exception 'project link merge failed: %',outcome; end if;
      update public.merge_job_items set applied_version=(outcome->>'version')::integer where id=item.id;
    end if;
  end loop;
  update public.merge_jobs set status='committed',committed_at=now(),summary=jsonb_build_object('applied',applied,'skipped',skipped) where id=job.id returning summary into response;
  insert into public.audit_logs(actor_user_id,workspace_id,action,target_type,target_id,metadata) values(caller,job.workspace_id,'merge.committed','merge_job',job.id::text,response);
  return response;
exception when others then
  if job.id is not null then update public.merge_jobs set status='failed',error_code=sqlstate where id=job.id; end if;
  raise;
end;
$$;

create or replace function public.rollback_merge(target_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare caller uuid:=auth.uid(); job public.merge_jobs%rowtype; item public.merge_job_items%rowtype; current_version integer; response jsonb; outcome jsonb; restored integer:=0;
begin
  select * into job from public.merge_jobs where id=target_job_id and requested_by=caller for update;
  if not found or job.status<>'committed' then raise exception 'committed merge job not found'; end if;
  if job.committed_at < now()-interval '7 days' then raise exception 'merge rollback window expired'; end if;
  for item in select * from public.merge_job_items where merge_job_id=job.id and applied_at is not null order by created_at desc loop
    execute format('select version from public.%I where id=$1 and workspace_id=$2 for update',item.entity_type) into current_version using item.target_record_id,job.workspace_id;
    if current_version is distinct from item.applied_version then raise exception 'merge item % changed after commit and cannot be rolled back',item.id; end if;
    response:=public.apply_sync_mutations(job.workspace_id,jsonb_build_array(jsonb_build_object(
      'mutationId',gen_random_uuid(),'entityType',item.entity_type,'logicalId',item.logical_id,
      'operation',case when item.target_snapshot is null then 'delete' else 'upsert' end,
      'expectedVersion',current_version,'payload',case when item.target_snapshot is null then item.source_payload else public.sync_payload_from_row(item.entity_type,item.target_snapshot) end)));
    outcome:=response->0;
    if outcome->>'outcome'<>'applied' then raise exception 'rollback item % failed: %',item.id,outcome; end if;
    restored:=restored+1;
  end loop;
  update public.merge_jobs set status='rolled_back',rolled_back_at=now(),summary=summary||jsonb_build_object('rolledBack',restored) where id=job.id returning summary into response;
  insert into public.audit_logs(actor_user_id,workspace_id,action,target_type,target_id,metadata) values(caller,job.workspace_id,'merge.rolled_back','merge_job',job.id::text,response);
  return response;
end;
$$;

revoke all on function public.stage_merge_export(uuid,uuid,jsonb) from public;
revoke all on function public.resolve_merge_item(uuid,text) from public;
revoke all on function public.commit_merge(uuid) from public;
revoke all on function public.rollback_merge(uuid) from public;
grant execute on function public.stage_merge_export(uuid,uuid,jsonb) to authenticated;
grant execute on function public.resolve_merge_item(uuid,text) to authenticated;
grant execute on function public.commit_merge(uuid) to authenticated;
grant execute on function public.rollback_merge(uuid) to authenticated;
