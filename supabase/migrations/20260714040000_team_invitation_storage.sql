-- Token-safe team invitation storage and server-side rate-limit ledger.
-- No browser write policies are defined; Edge Functions use service-role RPCs.

create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  inviter_user_id uuid references auth.users(id) on delete set null,
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 320),
  role text not null check (role in ('admin', 'member', 'viewer')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  token_hash text not null unique check (length(token_hash) = 64),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists team_invites_team_created_idx on public.team_invites(team_id, created_at desc);
create index if not exists team_invites_email_idx on public.team_invites(email);
create unique index if not exists one_pending_team_invite_per_email_idx
  on public.team_invites(team_id, email)
  where status = 'pending';

alter table public.team_invites enable row level security;

create policy "team admins read team invites"
  on public.team_invites for select
  using (public.is_team_admin(team_id));

create table if not exists public.team_invite_rate_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  recipient_hash text not null check (length(recipient_hash) = 64),
  created_at timestamptz not null default now()
);

create index if not exists team_invite_rate_actor_idx
  on public.team_invite_rate_events(actor_user_id, created_at desc);
create index if not exists team_invite_rate_team_idx
  on public.team_invite_rate_events(team_id, created_at desc);
create index if not exists team_invite_rate_recipient_idx
  on public.team_invite_rate_events(recipient_hash, created_at desc);

alter table public.team_invite_rate_events enable row level security;
-- No browser policies. Only the service-role rate-limit function writes here.

create or replace function public.consume_team_invite_rate_limit(
  actor_user_id uuid,
  target_team_id uuid,
  recipient_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict error
declare
  p_actor_user_id alias for $1;
  p_target_team_id alias for $2;
  p_recipient_hash alias for $3;
  v_actor_role text;
  v_actor_count integer;
  v_team_count integer;
  v_recipient_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  perform 1 from public.teams team where team.id = p_target_team_id for update;
  if not found then raise exception 'team not found' using errcode = 'P0002'; end if;

  select member.role into v_actor_role
    from public.team_members member
   where member.team_id = p_target_team_id
     and member.user_id = p_actor_user_id
     and member.status = 'active';
  if v_actor_role not in ('owner', 'admin') then
    raise exception 'team administration required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text, 10));
  perform pg_advisory_xact_lock(hashtextextended(p_target_team_id::text, 11));
  perform pg_advisory_xact_lock(hashtextextended(p_recipient_hash, 12));

  select count(*) into v_actor_count
    from public.team_invite_rate_events event
   where event.actor_user_id = p_actor_user_id
     and event.created_at > now() - interval '1 minute';
  select count(*) into v_team_count
    from public.team_invite_rate_events event
   where event.team_id = p_target_team_id
     and event.created_at > now() - interval '1 minute';
  select count(*) into v_recipient_count
    from public.team_invite_rate_events event
   where event.recipient_hash = p_recipient_hash
     and event.created_at > now() - interval '1 hour';

  if v_actor_count >= 10 or v_team_count >= 30 or v_recipient_count >= 3 then
    raise exception 'team invitation rate limit exceeded' using errcode = 'P0001';
  end if;

  insert into public.team_invite_rate_events(actor_user_id, team_id, recipient_hash)
  values (p_actor_user_id, p_target_team_id, p_recipient_hash);
end;
$$;

revoke all on function public.consume_team_invite_rate_limit(uuid, uuid, text) from public;
grant execute on function public.consume_team_invite_rate_limit(uuid, uuid, text) to service_role;
