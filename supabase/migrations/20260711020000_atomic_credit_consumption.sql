-- Atomically reserve managed-AI credits. This replaces read-then-write
-- accounting, which can overspend when a user sends concurrent requests.

create or replace function public.consume_daily_credits(
  target_user_id uuid,
  credit_cost integer,
  target_day date default current_date
)
returns table (credits_granted integer, credits_used integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if credit_cost < 1 then
    raise exception 'credit_cost must be positive';
  end if;

  insert into public.daily_credit_balances as balance (
    user_id, day, credits_granted, credits_used, updated_at
  )
  values (target_user_id, target_day, 10, credit_cost, now())
  on conflict (user_id, day) do update
    set credits_used = balance.credits_used + credit_cost,
        updated_at = now()
    where balance.credits_used + credit_cost <= balance.credits_granted
  returning balance.credits_granted, balance.credits_used
  into credits_granted, credits_used;

  if not found then
    return;
  end if;

  return next;
end;
$$;

revoke all on function public.consume_daily_credits(uuid, integer, date) from public;
grant execute on function public.consume_daily_credits(uuid, integer, date) to service_role;
