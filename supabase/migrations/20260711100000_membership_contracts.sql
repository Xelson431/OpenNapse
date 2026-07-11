-- Transactional membership and invitation contracts.

create or replace function public.remove_workspace_member(target_workspace_id uuid,target_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare caller uuid:=auth.uid(); caller_role text; target_role text;
begin
  select role into caller_role from public.workspace_members where workspace_id=target_workspace_id and user_id=caller and status='active';
  select role into target_role from public.workspace_members where workspace_id=target_workspace_id and user_id=target_user_id and status='active' for update;
  if caller_role not in ('owner','admin') then raise exception 'workspace administration required' using errcode='42501'; end if;
  if target_role is null then raise exception 'active member not found'; end if;
  if target_role='owner' then raise exception 'transfer ownership before removing the owner'; end if;
  if caller_role='admin' and target_role='admin' then raise exception 'admins cannot remove other admins'; end if;
  update public.workspace_members set status='removed' where workspace_id=target_workspace_id and user_id=target_user_id;
  insert into public.audit_logs(actor_user_id,workspace_id,action,target_type,target_id) values(caller,target_workspace_id,'workspace.member_removed','user',target_user_id::text);
end;
$$;

create or replace function public.accept_workspace_invite(target_invite_id uuid,target_user_id uuid)
returns table(workspace_id uuid,role text) language plpgsql security definer set search_path=public as $$
declare invite public.workspace_invites%rowtype; active_seats integer; seat_limit integer;
begin
  select * into invite from public.workspace_invites where id=target_invite_id for update;
  if not found or invite.status<>'pending' or invite.expires_at<=now() then raise exception 'invite is not active'; end if;
  perform pg_advisory_xact_lock(hashtextextended(invite.workspace_id::text,1));
  select count(*) into active_seats from public.workspace_members where workspace_members.workspace_id=invite.workspace_id and status='active';
  select max_seats into seat_limit from public.entitlement_limits(invite.workspace_id);
  if active_seats>=seat_limit then raise exception 'workspace seat entitlement exceeded'; end if;
  insert into public.workspace_members(workspace_id,user_id,role,status) values(invite.workspace_id,target_user_id,invite.role,'active')
  on conflict(workspace_id,user_id) do update set role=excluded.role,status='active';
  update public.workspace_invites set status='accepted',accepted_at=now() where id=invite.id;
  insert into public.audit_logs(actor_user_id,workspace_id,action,target_type,target_id,metadata) values(target_user_id,invite.workspace_id,'invite.accepted','workspace_invite',invite.id::text,jsonb_build_object('role',invite.role));
  return query select invite.workspace_id,invite.role;
end;
$$;

revoke all on function public.remove_workspace_member(uuid,uuid) from public;
revoke all on function public.accept_workspace_invite(uuid,uuid) from public;
grant execute on function public.remove_workspace_member(uuid,uuid) to authenticated;
grant execute on function public.accept_workspace_invite(uuid,uuid) to service_role;
