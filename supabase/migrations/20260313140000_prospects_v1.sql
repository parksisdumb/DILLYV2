-- Session 15: Prospect Universe + Import
-- Tables: import_batches, prospects
-- Dedup indexes on normalized domain and address

begin;

-- ============================================================
-- import_batches — tracks each CSV import
-- ============================================================
create table public.import_batches (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  filename      text not null,
  row_count     int  not null default 0,
  duplicates_skipped int not null default 0,
  territory_id  uuid references public.territories(id) on delete set null,
  icp_profile_id uuid references public.icp_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null
);

create index import_batches_org_idx on public.import_batches (org_id);

alter table public.import_batches enable row level security;

create policy import_batches_select_member on public.import_batches
  for select to authenticated
  using (public.rls_is_org_member(org_id));

create policy import_batches_insert_manager on public.import_batches
  for insert to authenticated
  with check (public.rls_is_manager_admin(org_id));

create policy import_batches_update_manager on public.import_batches
  for update to authenticated
  using (public.rls_is_manager_admin(org_id))
  with check (public.rls_is_manager_admin(org_id));

create policy import_batches_delete_manager on public.import_batches
  for delete to authenticated
  using (public.rls_is_manager_admin(org_id));

-- ============================================================
-- prospects — staging table for external data
-- ============================================================
create table public.prospects (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.orgs(id) on delete cascade,
  import_batch_id      uuid references public.import_batches(id) on delete set null,
  territory_id         uuid references public.territories(id) on delete set null,
  icp_profile_id       uuid references public.icp_profiles(id) on delete set null,

  -- company info
  company_name         text not null,
  website              text,
  domain_normalized    text,
  email                text,
  phone                text,
  linkedin_url         text,

  -- address
  address_line1        text,
  city                 text,
  state                text,
  postal_code          text,

  -- classification
  account_type         text,
  vertical             text,

  -- source tracking
  source               text not null default 'manual'
                        check (source in ('csv_import', 'manual', 'agent')),
  source_detail        text,
  confidence_score     int not null default 100,

  -- lifecycle
  status               text not null default 'unworked'
                        check (status in ('unworked', 'queued', 'converted', 'dismissed')),
  converted_entity_id  uuid,
  converted_entity_type text,

  notes                text,
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users(id) on delete set null
);

-- standard indexes
create index prospects_org_idx       on public.prospects (org_id);
create index prospects_status_idx    on public.prospects (org_id, status);
create index prospects_territory_idx on public.prospects (territory_id);
create index prospects_batch_idx     on public.prospects (import_batch_id);

-- dedup indexes
create unique index prospects_domain_dedupe_idx
  on public.prospects (org_id, domain_normalized)
  where domain_normalized is not null;

create unique index prospects_address_dedupe_idx
  on public.prospects (org_id, lower(postal_code), lower(address_line1))
  where address_line1 is not null;

-- RLS
alter table public.prospects enable row level security;

create policy prospects_select_member on public.prospects
  for select to authenticated
  using (public.rls_is_org_member(org_id));

create policy prospects_insert_manager on public.prospects
  for insert to authenticated
  with check (public.rls_is_manager_admin(org_id));

create policy prospects_update_manager on public.prospects
  for update to authenticated
  using (public.rls_is_manager_admin(org_id))
  with check (public.rls_is_manager_admin(org_id));

create policy prospects_delete_manager on public.prospects
  for delete to authenticated
  using (public.rls_is_manager_admin(org_id));

commit;
