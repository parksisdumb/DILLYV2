begin;

-- =========================================================
-- icp_profiles_v1
-- ICP (Ideal Customer Profile) system for targeting criteria.
-- Tables: icp_profiles, icp_criteria
-- =========================================================

-- -------------------------
-- 1. icp_profiles
-- -------------------------
create table if not exists public.icp_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  territory_id uuid references public.territories(id) on delete set null,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

drop trigger if exists trg_icp_profiles_updated_at on public.icp_profiles;
create trigger trg_icp_profiles_updated_at
before update on public.icp_profiles
for each row execute function public.set_updated_at();

create index if not exists icp_profiles_org_idx on public.icp_profiles (org_id);
create index if not exists icp_profiles_territory_idx on public.icp_profiles (territory_id);

-- -------------------------
-- 2. icp_criteria
-- -------------------------
create table if not exists public.icp_criteria (
  id uuid primary key default gen_random_uuid(),
  icp_profile_id uuid not null references public.icp_profiles(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  criteria_type text not null check (criteria_type in (
    'account_type', 'vertical', 'property_size_min', 'property_size_max',
    'roof_age_min', 'roof_age_max', 'building_type', 'decision_role'
  )),
  criteria_value text not null,
  created_at timestamptz not null default now()
);

create index if not exists icp_criteria_profile_idx on public.icp_criteria (icp_profile_id);
create index if not exists icp_criteria_org_idx on public.icp_criteria (org_id);
create unique index if not exists icp_criteria_dedupe_idx
  on public.icp_criteria (icp_profile_id, criteria_type, lower(criteria_value));

-- -------------------------
-- 3. RLS
-- -------------------------

-- icp_profiles
alter table public.icp_profiles enable row level security;

drop policy if exists icp_profiles_select_member on public.icp_profiles;
create policy icp_profiles_select_member
on public.icp_profiles for select to authenticated
using (public.rls_is_org_member(org_id));

drop policy if exists icp_profiles_insert_manager on public.icp_profiles;
create policy icp_profiles_insert_manager
on public.icp_profiles for insert to authenticated
with check (public.rls_is_manager_admin(org_id));

drop policy if exists icp_profiles_update_manager on public.icp_profiles;
create policy icp_profiles_update_manager
on public.icp_profiles for update to authenticated
using (public.rls_is_manager_admin(org_id))
with check (public.rls_is_manager_admin(org_id));

drop policy if exists icp_profiles_delete_manager on public.icp_profiles;
create policy icp_profiles_delete_manager
on public.icp_profiles for delete to authenticated
using (public.rls_is_manager_admin(org_id));

-- icp_criteria
alter table public.icp_criteria enable row level security;

drop policy if exists icp_criteria_select_member on public.icp_criteria;
create policy icp_criteria_select_member
on public.icp_criteria for select to authenticated
using (public.rls_is_org_member(org_id));

drop policy if exists icp_criteria_insert_manager on public.icp_criteria;
create policy icp_criteria_insert_manager
on public.icp_criteria for insert to authenticated
with check (public.rls_is_manager_admin(org_id));

drop policy if exists icp_criteria_update_manager on public.icp_criteria;
create policy icp_criteria_update_manager
on public.icp_criteria for update to authenticated
using (public.rls_is_manager_admin(org_id))
with check (public.rls_is_manager_admin(org_id));

drop policy if exists icp_criteria_delete_manager on public.icp_criteria;
create policy icp_criteria_delete_manager
on public.icp_criteria for delete to authenticated
using (public.rls_is_manager_admin(org_id));

commit;
