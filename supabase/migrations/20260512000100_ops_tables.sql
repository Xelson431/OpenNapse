-- OpenNapse ops tables: invites, AI usage, credits, provider configs, audit logs.
-- Applies after 20260512000000_content_tables.sql.

create extension if not exists pgcrypto;

-- =========================================================================
-- workspace_invites
-- =========================================================================
create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  inviter_user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'member', 'viewer')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired', 'revoked')),
  token text not null unique,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists workspace_invites_workspace_idx on public.workspace_invites(workspace_id);
create index if not exists workspace_invites_email_idx on public.workspace_invites(lower(email));
alter table public.workspace_invites enable row level security;

-- Owners/admins of the workspace can read and manage invites. Inviters can read their own.
create policy "workspace admins read invites"
  on public.workspace_invites for select
  using (
    exists (
      select 1 from public.workspace_members member
      where member.workspace_id = workspace_invites.workspace_id
        and member.user_id = auth.uid()
        and member.status = 'active'
        and member.role in ('owner', 'admin')
    )
  );

create policy "workspace admins manage invites"
  on public.workspace_invites for insert
  with check (
    inviter_user_id = auth.uid()
    and exists (
      select 1 from public.workspace_members member
      where member.workspace_id = workspace_invites.workspace_id
        and member.user_id = auth.uid()
        and member.status = 'active'
        and member.role in ('owner', 'admin')
    )
  );

create policy "workspace admins update invites"
  on public.workspace_invites for update
  using (
    exists (
      select 1 from public.workspace_members member
      where member.workspace_id = workspace_invites.workspace_id
        and member.user_id = auth.uid()
        and member.status = 'active'
        and member.role in ('owner', 'admin')
    )
  );

-- =========================================================================
-- ai_provider_configs (BYOK at user or team scope)
-- =========================================================================
create table if not exists public.ai_provider_configs (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('user', 'workspace')),
  user_id uuid references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  provider_id text not null,
  display_name text not null default '',
  base_url text,
  model_id text,
  -- Encrypted key material lives in vault.secrets via supabase_vault; this
  -- table only stores a reference id. Never write plaintext keys here.
  vault_secret_id uuid,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope = 'user' and user_id is not null and workspace_id is null)
    or (scope = 'workspace' and workspace_id is not null)
  )
);
create index if not exists ai_provider_configs_user_idx on public.ai_provider_configs(user_id);
create index if not exists ai_provider_configs_workspace_idx on public.ai_provider_configs(workspace_id);
alter table public.ai_provider_configs enable row level security;

create policy "user reads own provider configs"
  on public.ai_provider_configs for select
  using (
    (scope = 'user' and user_id = auth.uid())
    or (scope = 'workspace' and workspace_id is not null and public.is_workspace_member(workspace_id))
  );

create policy "user manages own provider configs"
  on public.ai_provider_configs for insert
  with check (
    (scope = 'user' and user_id = auth.uid())
    or (
      scope = 'workspace'
      and workspace_id is not null
      and exists (
        select 1 from public.workspace_members member
        where member.workspace_id = ai_provider_configs.workspace_id
          and member.user_id = auth.uid()
          and member.status = 'active'
          and member.role in ('owner', 'admin')
      )
    )
  );

create policy "user updates own provider configs"
  on public.ai_provider_configs for update
  using (
    (scope = 'user' and user_id = auth.uid())
    or (
      scope = 'workspace'
      and workspace_id is not null
      and exists (
        select 1 from public.workspace_members member
        where member.workspace_id = ai_provider_configs.workspace_id
          and member.user_id = auth.uid()
          and member.status = 'active'
          and member.role in ('owner', 'admin')
      )
    )
  );

create policy "user deletes own provider configs"
  on public.ai_provider_configs for delete
  using (
    (scope = 'user' and user_id = auth.uid())
    or (
      scope = 'workspace'
      and workspace_id is not null
      and exists (
        select 1 from public.workspace_members member
        where member.workspace_id = ai_provider_configs.workspace_id
          and member.user_id = auth.uid()
          and member.status = 'active'
          and member.role in ('owner', 'admin')
      )
    )
  );

-- =========================================================================
-- ai_usage_events (logged by runAiAction Edge Function)
-- =========================================================================
create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  provider_id text not null,
  provider_config_id uuid references public.ai_provider_configs(id) on delete set null,
  model_id text not null,
  action_type text not null,
  input_tokens integer,
  output_tokens integer,
  estimated_provider_cost_usd numeric(10, 6),
  credits_charged integer not null default 0,
  used_byok boolean not null default false,
  status text not null default 'ok' check (status in ('ok', 'error', 'blocked')),
  error_code text,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_created_idx on public.ai_usage_events(user_id, created_at desc);
create index if not exists ai_usage_workspace_created_idx on public.ai_usage_events(workspace_id, created_at desc);
alter table public.ai_usage_events enable row level security;

create policy "user reads own usage events"
  on public.ai_usage_events for select
  using (
    user_id = auth.uid()
    or (
      workspace_id is not null
      and exists (
        select 1 from public.workspace_members member
        where member.workspace_id = ai_usage_events.workspace_id
          and member.user_id = auth.uid()
          and member.status = 'active'
          and member.role in ('owner', 'admin')
      )
    )
  );

-- Writes happen from Edge Functions with service-role; no user-level insert policy.

-- =========================================================================
-- daily_credit_balances (UTC day rollups)
-- =========================================================================
create table if not exists public.daily_credit_balances (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  credits_granted integer not null default 10,
  credits_used integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.daily_credit_balances enable row level security;

create policy "user reads own daily balance"
  on public.daily_credit_balances for select
  using (user_id = auth.uid());

-- =========================================================================
-- audit_logs (security-sensitive actions)
-- =========================================================================
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_workspace_idx on public.audit_logs(workspace_id, created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs(actor_user_id, created_at desc);
alter table public.audit_logs enable row level security;

create policy "workspace admins read audit logs"
  on public.audit_logs for select
  using (
    workspace_id is not null
    and exists (
      select 1 from public.workspace_members member
      where member.workspace_id = audit_logs.workspace_id
        and member.user_id = auth.uid()
        and member.status = 'active'
        and member.role in ('owner', 'admin')
    )
  );

create policy "user reads own audit trail"
  on public.audit_logs for select
  using (actor_user_id = auth.uid());

-- Writes are performed by Edge Functions with service-role.
