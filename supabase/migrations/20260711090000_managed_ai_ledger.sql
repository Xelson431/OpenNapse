-- Idempotent managed-AI reservation and reconciliation ledger.

create table if not exists public.managed_ai_invocations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  action_type text not null,
  provider_id text not null,
  model_id text,
  credit_cost integer not null check(credit_cost>=0),
  state text not null check(state in ('reserved','dispatched','succeeded','refunded','failed')),
  provider_request_id text,
  error_code text,
  reserved_at timestamptz not null default now(),
  dispatched_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists managed_ai_invocations_user_created_idx on public.managed_ai_invocations(user_id,reserved_at desc);
alter table public.managed_ai_invocations enable row level security;
create policy "users read own managed ai invocations" on public.managed_ai_invocations for select using(user_id=auth.uid());

create or replace function public.reserve_managed_ai_invocation(target_user_id uuid,target_workspace_id uuid,request_key uuid,requested_action text,requested_provider text,requested_model text,credit_cost integer)
returns table(invocation_id uuid,state text,credits_granted integer,credits_used integer)
language plpgsql security definer set search_path=public as $$
declare existing public.managed_ai_invocations%rowtype; allowance integer; used_now integer; granted_now integer;
begin
  if credit_cost<0 then raise exception 'credit cost cannot be negative'; end if;
  perform pg_advisory_xact_lock(hashtextextended(request_key::text,2));
  select * into existing from public.managed_ai_invocations where idempotency_key=request_key;
  if found then return query select existing.id,existing.state,b.credits_granted,b.credits_used from public.daily_credit_balances b where b.user_id=existing.user_id and b.day=current_date; return; end if;
  select daily_managed_ai_credits into allowance from public.entitlement_limits(target_workspace_id);
  allowance:=coalesce(allowance,10);
  insert into public.daily_credit_balances as balance(user_id,day,credits_granted,credits_used,updated_at)
  values(target_user_id,current_date,allowance,credit_cost,now())
  on conflict(user_id,day) do update set credits_granted=allowance,credits_used=balance.credits_used+credit_cost,updated_at=now()
  where balance.credits_used+credit_cost<=allowance
  returning balance.credits_granted,balance.credits_used into granted_now,used_now;
  if not found then return; end if;
  insert into public.managed_ai_invocations as invocation(idempotency_key,user_id,workspace_id,action_type,provider_id,model_id,credit_cost,state)
  values(request_key,target_user_id,target_workspace_id,requested_action,requested_provider,requested_model,credit_cost,'reserved') returning invocation.id,invocation.state into invocation_id,state;
  credits_granted:=granted_now; credits_used:=used_now; return next;
end;
$$;

create or replace function public.transition_managed_ai_invocation(target_invocation_id uuid,expected_state text,next_state text,provider_request text default null,failure_code text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare invocation public.managed_ai_invocations%rowtype;
begin
  if (expected_state,next_state) not in (('reserved','dispatched'),('dispatched','succeeded'),('reserved','refunded'),('dispatched','refunded'),('reserved','failed'),('dispatched','failed')) then raise exception 'invalid invocation transition'; end if;
  select * into invocation from public.managed_ai_invocations where id=target_invocation_id for update;
  if not found or invocation.state<>expected_state then return false; end if;
  update public.managed_ai_invocations set state=next_state,provider_request_id=coalesce(provider_request,provider_request_id),error_code=failure_code,
    dispatched_at=case when next_state='dispatched' then now() else dispatched_at end,
    completed_at=case when next_state in ('succeeded','refunded','failed') then now() else completed_at end,updated_at=now() where id=target_invocation_id;
  if next_state='refunded' and invocation.credit_cost>0 then
    update public.daily_credit_balances set credits_used=greatest(credits_used-invocation.credit_cost,0),updated_at=now() where user_id=invocation.user_id and day=invocation.reserved_at::date;
  end if;
  return true;
end;
$$;

revoke all on function public.reserve_managed_ai_invocation(uuid,uuid,uuid,text,text,text,integer) from public;
revoke all on function public.transition_managed_ai_invocation(uuid,text,text,text,text) from public;
grant execute on function public.reserve_managed_ai_invocation(uuid,uuid,uuid,text,text,text,integer) to service_role;
grant execute on function public.transition_managed_ai_invocation(uuid,text,text,text,text) to service_role;
