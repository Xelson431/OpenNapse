-- Hosted platform foundation.
--
-- This migration is intentionally additive and safe for currently deployed
-- clients. Application code must not require logical_id until the later
-- backfill and dual-write rollout have completed.

create table if not exists public.platform_schema_contracts (
  contract_name text primary key,
  contract_version integer not null check (contract_version > 0),
  applied_at timestamptz not null default now(),
  notes text not null default ''
);

insert into public.platform_schema_contracts (contract_name, contract_version, notes)
values (
  'hosted-platform',
  1,
  'Additive hosted foundation: billing compatibility marker and nullable stable record identities.'
)
on conflict (contract_name) do update set
  contract_version = greatest(public.platform_schema_contracts.contract_version, excluded.contract_version),
  notes = excluded.notes;

-- logical_id identifies a logical record across devices and merge retries.
-- Existing rows remain nullable until a resumable backfill and client dual-write
-- release are verified. Do not add NOT NULL or a unique constraint yet.
alter table public.ideas add column if not exists logical_id uuid;
alter table public.projects add column if not exists logical_id uuid;
alter table public.tasks add column if not exists logical_id uuid;
alter table public.notes add column if not exists logical_id uuid;

comment on column public.ideas.logical_id is
  'Stable cross-device identity. Backfilled before merge/sync rollout.';
comment on column public.projects.logical_id is
  'Stable cross-device identity. Backfilled before merge/sync rollout.';
comment on column public.tasks.logical_id is
  'Stable cross-device identity. Backfilled before merge/sync rollout.';
comment on column public.notes.logical_id is
  'Stable cross-device identity. Backfilled before merge/sync rollout.';
