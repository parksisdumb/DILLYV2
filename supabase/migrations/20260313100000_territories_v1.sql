begin;

-- =========================================================
-- territories_v1
-- Territory system: geographic regions assigned to reps.
-- Tables: territories, territory_regions, territory_assignments
-- =========================================================

-- -------------------------
-- 1. territories
-- -------------------------
create table if not exists public.territories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

drop trigger if exists trg_territories_updated_at on public.territories;
create trigger trg_territories_updated_at
before update on public.territories
for each row execute function public.set_updated_at();

create index if not exists territories_org_idx on public.territories (org_id);
create index if not exists territories_org_name_idx on public.territories (org_id, name);

-- -------------------------
-- 2. territory_regions
-- -------------------------
create table if not exists public.territory_regions (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references public.territories(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  region_type text not null check (region_type in ('zip', 'city', 'county')),
  region_value text not null,
  state text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists territory_regions_dedupe_idx
  on public.territory_regions (territory_id, region_type, lower(region_value), lower(state));

create index if not exists territory_regions_territory_idx on public.territory_regions (territory_id);
create index if not exists territory_regions_org_idx on public.territory_regions (org_id);

-- -------------------------
-- 3. territory_assignments
-- -------------------------
create table if not exists public.territory_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  territory_id uuid not null references public.territories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'primary' check (role in ('primary', 'secondary', 'manager')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create unique index if not exists territory_assignments_dedupe_idx
  on public.territory_assignments (territory_id, user_id);

create index if not exists territory_assignments_territory_idx on public.territory_assignments (territory_id);
create index if not exists territory_assignments_user_idx on public.territory_assignments (user_id);
create index if not exists territory_assignments_org_idx on public.territory_assignments (org_id);

-- -------------------------
-- 4. RLS
-- -------------------------

-- territories
alter table public.territories enable row level security;

drop policy if exists territories_select_member on public.territories;
create policy territories_select_member
on public.territories for select to authenticated
using (public.rls_is_org_member(org_id));

drop policy if exists territories_insert_manager on public.territories;
create policy territories_insert_manager
on public.territories for insert to authenticated
with check (public.rls_is_manager_admin(org_id));

drop policy if exists territories_update_manager on public.territories;
create policy territories_update_manager
on public.territories for update to authenticated
using (public.rls_is_manager_admin(org_id))
with check (public.rls_is_manager_admin(org_id));

drop policy if exists territories_delete_manager on public.territories;
create policy territories_delete_manager
on public.territories for delete to authenticated
using (public.rls_is_manager_admin(org_id));

-- territory_regions
alter table public.territory_regions enable row level security;

drop policy if exists territory_regions_select_member on public.territory_regions;
create policy territory_regions_select_member
on public.territory_regions for select to authenticated
using (public.rls_is_org_member(org_id));

drop policy if exists territory_regions_insert_manager on public.territory_regions;
create policy territory_regions_insert_manager
on public.territory_regions for insert to authenticated
with check (public.rls_is_manager_admin(org_id));

drop policy if exists territory_regions_delete_manager on public.territory_regions;
create policy territory_regions_delete_manager
on public.territory_regions for delete to authenticated
using (public.rls_is_manager_admin(org_id));

-- territory_assignments
alter table public.territory_assignments enable row level security;

drop policy if exists territory_assignments_select_member on public.territory_assignments;
create policy territory_assignments_select_member
on public.territory_assignments for select to authenticated
using (public.rls_is_org_member(org_id));

drop policy if exists territory_assignments_insert_manager on public.territory_assignments;
create policy territory_assignments_insert_manager
on public.territory_assignments for insert to authenticated
with check (public.rls_is_manager_admin(org_id));

drop policy if exists territory_assignments_update_manager on public.territory_assignments;
create policy territory_assignments_update_manager
on public.territory_assignments for update to authenticated
using (public.rls_is_manager_admin(org_id))
with check (public.rls_is_manager_admin(org_id));

drop policy if exists territory_assignments_delete_manager on public.territory_assignments;
create policy territory_assignments_delete_manager
on public.territory_assignments for delete to authenticated
using (public.rls_is_manager_admin(org_id));

commit;
