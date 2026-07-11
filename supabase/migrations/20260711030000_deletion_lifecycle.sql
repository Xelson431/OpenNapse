-- Destructive hosted-data operations are staged and auditable. Clients must
-- never delete a cloud workspace or account directly.

create table if not exists public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('workspace', 'account')),
  workspace_id uuid references public.workspaces(id) on delete set null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'cancelled', 'approved', 'executing', 'completed', 'failed')),
  confirmation_token uuid not null,
  scheduled_for timestamptz not null default (now() + interval '30 days'),
  cancelled_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope = 'workspace' and workspace_id is not null)
    or (scope = 'account' and workspace_id is null)
  )
);

create index if not exists deletion_requests_requested_by_idx
  on public.deletion_requests(requested_by, created_at desc);
create index if not exists deletion_requests_pending_schedule_idx
  on public.deletion_requests(scheduled_for)
  where status in ('pending', 'approved');

alter table public.deletion_requests enable row level security;

create policy "users read their deletion requests"
  on public.deletion_requests for select
  using (requested_by = auth.uid());

create policy "workspace owners request workspace deletion"
  on public.deletion_requests for insert
  with check (
    requested_by = auth.uid()
    and (
      scope = 'account'
      or exists (
        select 1 from public.workspace_members member
        where member.workspace_id = deletion_requests.workspace_id
          and member.user_id = auth.uid()
          and member.status = 'active'
          and member.role = 'owner'
      )
    )
  );

create policy "users cancel pending deletion requests"
  on public.deletion_requests for update
  using (requested_by = auth.uid() and status = 'pending')
  with check (
    requested_by = auth.uid()
    and status = 'cancelled'
    and cancelled_at is not null
  );

drop trigger if exists deletion_requests_updated_at on public.deletion_requests;
create trigger deletion_requests_updated_at before update on public.deletion_requests
  for each row execute function public.set_updated_at_now();
