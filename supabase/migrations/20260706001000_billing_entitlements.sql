-- Generic hosted billing/entitlement tables.
-- Stripe-specific checkout/webhook code stays in the private billing wrapper.

create extension if not exists pgcrypto;

create table if not exists public.billing_plans (
  id text primary key,
  name text not null,
  description text not null default '',
  price_label text,
  features jsonb not null default '{}'::jsonb,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id text not null references public.billing_plans(id),
  external_customer_id text,
  external_subscription_id text unique,
  status text not null check (status in ('free', 'active', 'trialing', 'past_due', 'canceled', 'incomplete')) default 'free',
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id)
);

create index if not exists workspace_subscriptions_workspace_idx on public.workspace_subscriptions(workspace_id);
create index if not exists workspace_subscriptions_external_customer_idx on public.workspace_subscriptions(external_customer_id);

alter table public.billing_plans enable row level security;
alter table public.workspace_subscriptions enable row level security;

create policy "anyone can read public billing plans"
  on public.billing_plans for select
  using (is_public = true);

create policy "workspace admins read subscriptions"
  on public.workspace_subscriptions for select
  using (
    exists (
      select 1 from public.workspace_members member
      where member.workspace_id = workspace_subscriptions.workspace_id
        and member.user_id = auth.uid()
        and member.status = 'active'
        and member.role in ('owner', 'admin')
    )
  );

-- No browser insert/update/delete policies. Private billing wrapper writes with
-- service role after verifying Stripe webhooks and caller JWTs.

insert into public.billing_plans (id, name, description, price_label, features, is_public)
values
  ('free', 'Free', 'Local-first OpenNapse with optional self-hosted cloud.', null, '{"cloud_sync": true, "team_workspaces": false}'::jsonb, true),
  ('pro', 'Pro', 'Hosted OpenNapse plan. Pricing is supplied by the private billing wrapper.', null, '{"cloud_sync": true, "team_workspaces": true, "higher_ai_limits": true}'::jsonb, true)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  features = excluded.features,
  is_public = excluded.is_public,
  updated_at = now();
