-- =========================================================
-- Dilly v2 - init_schema_v1
-- Tables + indexes + core triggers (NO RLS in this migration)
-- =========================================================

-- -------------------------
-- 0) Extensions
-- -------------------------
create extension if not exists "pgcrypto";

-- -------------------------
-- 1) Updated-at trigger
-- -------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================
-- 2) ORG / AUTH MODEL
-- =========================================================

create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Auto-create profile row on signup (standard Supabase pattern)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Roles are org-scoped, but we also allow global defaults (org_id null)
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs(id) on delete cascade,
  key text not null,         -- rep | manager | admin
  name text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

-- Ensure uniqueness for org-specific roles, and for global defaults.
create unique index if not exists roles_unique_global_key
  on public.roles (key) where org_id is null;

create unique index if not exists roles_unique_org_key
  on public.roles (org_id, key) where org_id is not null;

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (org_id, user_id)
);

create index if not exists memberships_user_idx on public.memberships (user_id);
create index if not exists memberships_org_idx on public.memberships (org_id);

-- =========================================================
-- 3) CORE CRM ENTITIES (ACCOUNT / CONTACT / PROPERTY)
-- =========================================================

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  account_type text, -- owner | manager | gc | referral_partner | etc (config later)
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

drop trigger if exists trg_accounts_updated_at on public.accounts;
create trigger trg_accounts_updated_at
before update on public.accounts
for each row execute function public.set_updated_at();

create index if not exists accounts_org_idx on public.accounts (org_id);
create index if not exists accounts_name_idx on public.accounts (org_id, name);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  full_name text not null,
  title text,
  email text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

drop trigger if exists trg_contacts_updated_at on public.contacts;
create trigger trg_contacts_updated_at
before update on public.contacts
for each row execute function public.set_updated_at();

create index if not exists contacts_org_idx on public.contacts (org_id);
create index if not exists contacts_account_idx on public.contacts (account_id);

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,

  -- Address (property-first)
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state text not null,
  postal_code text not null,
  country text not null default 'US',

  -- Required by product spec (can be populated at creation; allow null temporarily if needed)
  primary_account_id uuid references public.accounts(id) on delete set null,
  primary_contact_id uuid references public.contacts(id) on delete set null,

  -- Optional metadata (future)
  external_ref text,
  notes text,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

drop trigger if exists trg_properties_updated_at on public.properties;
create trigger trg_properties_updated_at
before update on public.properties
for each row execute function public.set_updated_at();

create index if not exists properties_org_idx on public.properties (org_id);
create index if not exists properties_address_idx on public.properties (org_id, postal_code, address_line1);

-- Access control at the property level
create table if not exists public.property_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_role text not null default 'assigned_rep', -- owner | assigned_rep | viewer
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (property_id, user_id)
);

create index if not exists property_assignments_org_idx on public.property_assignments (org_id);
create index if not exists property_assignments_user_idx on public.property_assignments (user_id);
create index if not exists property_assignments_property_idx on public.property_assignments (property_id);

-- =========================================================
-- 4) OPPORTUNITIES (REVENUE OBJECTS) + CONFIG TABLES
-- =========================================================

-- Configurable scope types (roofing defaults inserted later)
create table if not exists public.scope_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs(id) on delete cascade, -- null = global default
  key text not null,   -- inspection | repair | replacement | service_maintenance | new_construction | other
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create unique index if not exists scope_types_unique_global_key
  on public.scope_types (key) where org_id is null;

create unique index if not exists scope_types_unique_org_key
  on public.scope_types (org_id, key) where org_id is not null;

-- Configurable opportunity stages (roofing defaults inserted later)
create table if not exists public.opportunity_stages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs(id) on delete cascade, -- null = global default
  key text not null,   -- open_pre_inspection, inspection_scheduled, ..., won, lost
  name text not null,
  sort_order int not null default 0,
  is_closed_stage boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create unique index if not exists opportunity_stages_unique_global_key
  on public.opportunity_stages (key) where org_id is null;

create unique index if not exists opportunity_stages_unique_org_key
  on public.opportunity_stages (org_id, key) where org_id is not null;

-- Lost reasons (defaults inserted later)
create table if not exists public.lost_reason_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs(id) on delete cascade, -- null = global default
  key text not null,   -- price, competitor, timing, no_decision, no_response, relationship, scope_change, capacity, other
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create unique index if not exists lost_reason_unique_global_key
  on public.lost_reason_types (key) where org_id is null;

create unique index if not exists lost_reason_unique_org_key
  on public.lost_reason_types (org_id, key) where org_id is not null;

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,

  property_id uuid not null references public.properties(id) on delete cascade,
  scope_type_id uuid not null references public.scope_types(id) on delete restrict,
  stage_id uuid not null references public.opportunity_stages(id) on delete restrict,

  status text not null default 'open', -- open | won | lost (can be derived later)
  title text, -- optional human label

  estimated_value numeric(12,2),
  bid_value numeric(12,2),
  final_value numeric(12,2),

  created_reason text, -- inspection_scheduled | bid_requested | gc_bid_request | manual | etc
  created_from_touchpoint_id uuid, -- fk added after touchpoints table exists (see later)

  opened_at timestamptz not null default now(),
  closed_at timestamptz,

  lost_reason_type_id uuid references public.lost_reason_types(id) on delete set null,
  lost_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

drop trigger if exists trg_opportunities_updated_at on public.opportunities;
create trigger trg_opportunities_updated_at
before update on public.opportunities
for each row execute function public.set_updated_at();

create index if not exists opportunities_org_idx on public.opportunities (org_id);
create index if not exists opportunities_property_idx on public.opportunities (property_id);
create index if not exists opportunities_stage_idx on public.opportunities (stage_id);
create index if not exists opportunities_status_idx on public.opportunities (org_id, status);

-- Multi-rep collaboration on opportunities
create table if not exists public.opportunity_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_role text not null default 'primary_rep', -- primary_rep | estimator | sales_support | manager
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (opportunity_id, user_id)
);

create index if not exists opportunity_assignments_org_idx on public.opportunity_assignments (org_id);
create index if not exists opportunity_assignments_user_idx on public.opportunity_assignments (user_id);
create index if not exists opportunity_assignments_opp_idx on public.opportunity_assignments (opportunity_id);

-- =========================================================
-- 5) TOUCHPOINTS (TRUTH LEDGER) + CONFIG TABLES
-- =========================================================

create table if not exists public.touchpoint_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs(id) on delete cascade, -- null = global default
  key text not null,  -- call | email | pop_in
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create unique index if not exists touchpoint_types_unique_global_key
  on public.touchpoint_types (key) where org_id is null;

create unique index if not exists touchpoint_types_unique_org_key
  on public.touchpoint_types (org_id, key) where org_id is not null;

create table if not exists public.milestone_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs(id) on delete cascade, -- null = global default
  key text not null, -- inspection_scheduled, bid_submitted, etc
  name text not null,
  sort_order int not null default 0,
  default_points int,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create unique index if not exists milestone_types_unique_global_key
  on public.milestone_types (key) where org_id is null;

create unique index if not exists milestone_types_unique_org_key
  on public.milestone_types (org_id, key) where org_id is not null;

create table if not exists public.touchpoint_outcomes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs(id) on delete cascade, -- null = global default
  touchpoint_type_id uuid references public.touchpoint_types(id) on delete set null, -- nullable = shared outcomes allowed
  key text not null,
  name text not null,
  category text, -- data_hygiene | engagement | inspection | bid | decision
  sort_order int not null default 0,

  -- suggestion mapping
  suggested_stage_id uuid references public.opportunity_stages(id) on delete set null,
  creates_milestone_type_id uuid references public.milestone_types(id) on delete set null,
  qualifies_opportunity boolean not null default false,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create unique index if not exists touchpoint_outcomes_unique_global_key
  on public.touchpoint_outcomes (key) where org_id is null;

create unique index if not exists touchpoint_outcomes_unique_org_key
  on public.touchpoint_outcomes (org_id, key) where org_id is not null;

-- Touchpoints: property_id is required by v2 design.
create table if not exists public.touchpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,

  rep_user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,

  account_id uuid references public.accounts(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,

  touchpoint_type_id uuid not null references public.touchpoint_types(id) on delete restrict,
  outcome_id uuid references public.touchpoint_outcomes(id) on delete set null,

  happened_at timestamptz not null default now(),
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

drop trigger if exists trg_touchpoints_updated_at on public.touchpoints;
create trigger trg_touchpoints_updated_at
before update on public.touchpoints
for each row execute function public.set_updated_at();

create index if not exists touchpoints_org_idx on public.touchpoints (org_id);
create index if not exists touchpoints_property_time_idx on public.touchpoints (org_id, property_id, happened_at desc);
create index if not exists touchpoints_rep_time_idx on public.touchpoints (org_id, rep_user_id, happened_at desc);
create index if not exists touchpoints_opp_time_idx on public.touchpoints (org_id, opportunity_id, happened_at desc);

-- Now that touchpoints exists, add FK from opportunities.created_from_touchpoint_id safely
do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where constraint_name = 'opportunities_created_from_touchpoint_fk'
  ) then
    alter table public.opportunities
      add constraint opportunities_created_from_touchpoint_fk
      foreign key (created_from_touchpoint_id)
      references public.touchpoints(id)
      on delete set null;
  end if;
end $$;

-- Manager edit audit for touchpoints
create table if not exists public.touchpoint_revisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  touchpoint_id uuid not null references public.touchpoints(id) on delete cascade,
  revised_at timestamptz not null default now(),
  revised_by uuid not null references auth.users(id) on delete cascade,
  reason text,
  before jsonb not null,
  after jsonb not null
);

create index if not exists touchpoint_revisions_touchpoint_idx on public.touchpoint_revisions (touchpoint_id);

-- =========================================================
-- 6) OPPORTUNITY MILESTONES (EVENT LEDGER)
-- =========================================================

create table if not exists public.opportunity_milestones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  milestone_type_id uuid not null references public.milestone_types(id) on delete restrict,
  happened_at timestamptz not null default now(),
  source_touchpoint_id uuid references public.touchpoints(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists opportunity_milestones_opp_idx on public.opportunity_milestones (opportunity_id);
create index if not exists opportunity_milestones_type_time_idx on public.opportunity_milestones (org_id, milestone_type_id, happened_at desc);

-- =========================================================
-- 7) NEXT ACTIONS (FOLLOW-UP ENGINE)
-- =========================================================

create table if not exists public.next_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,

  property_id uuid not null references public.properties(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,

  assigned_user_id uuid not null references auth.users(id) on delete cascade,
  recommended_touchpoint_type_id uuid references public.touchpoint_types(id) on delete set null,

  due_at timestamptz not null,
  status text not null default 'open', -- open | completed | snoozed | cancelled
  notes text,

  created_from_touchpoint_id uuid references public.touchpoints(id) on delete set null,
  completed_by_touchpoint_id uuid references public.touchpoints(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

drop trigger if exists trg_next_actions_updated_at on public.next_actions;
create trigger trg_next_actions_updated_at
before update on public.next_actions
for each row execute function public.set_updated_at();

create index if not exists next_actions_assigned_due_idx on public.next_actions (org_id, assigned_user_id, due_at);
create index if not exists next_actions_status_due_idx on public.next_actions (org_id, status, due_at);

-- =========================================================
-- 8) KPI + SCORING (BASELINE)
-- =========================================================

create table if not exists public.kpi_definitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs(id) on delete cascade, -- null = global default
  key text not null,
  name text not null,
  metric_type text not null default 'count', -- count | value

  -- mapping fields (one or more may be used)
  touchpoint_type_id uuid references public.touchpoint_types(id) on delete set null,
  outcome_id uuid references public.touchpoint_outcomes(id) on delete set null,
  milestone_type_id uuid references public.milestone_types(id) on delete set null,
  entity_type text,     -- 'contact' | 'property' | 'opportunity'
  entity_event text,    -- 'created'

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create unique index if not exists kpi_definitions_unique_global_key
  on public.kpi_definitions (key) where org_id is null;

create unique index if not exists kpi_definitions_unique_org_key
  on public.kpi_definitions (org_id, key) where org_id is not null;

create table if not exists public.kpi_targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null, -- daily | weekly | monthly
  kpi_definition_id uuid not null references public.kpi_definitions(id) on delete cascade,
  target_value numeric(12,2) not null,
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists kpi_targets_user_idx on public.kpi_targets (org_id, user_id);

create table if not exists public.score_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs(id) on delete cascade, -- null = global default

  touchpoint_type_id uuid references public.touchpoint_types(id) on delete set null,
  outcome_id uuid references public.touchpoint_outcomes(id) on delete set null,
  milestone_type_id uuid references public.milestone_types(id) on delete set null,

  points int not null,
  is_bonus boolean not null default false,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.score_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  touchpoint_id uuid references public.touchpoints(id) on delete set null,
  milestone_id uuid references public.opportunity_milestones(id) on delete set null,

  points int not null,
  reason text,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists score_events_user_time_idx on public.score_events (org_id, user_id, created_at desc);

create table if not exists public.streaks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  streak_type text not null, -- daily_activity | followup_compliance | etc
  current_count int not null default 0,
  last_earned_date date,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (org_id, user_id, streak_type)
);

-- =========================================================
-- 9) DEDUP / MERGE AUDIT (MINIMAL)
-- =========================================================

create table if not exists public.merge_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  entity_type text not null, -- property | account | contact
  source_entity_id uuid not null,
  target_entity_id uuid not null,
  merged_at timestamptz not null default now(),
  merged_by uuid references auth.users(id) on delete set null,
  notes text
);

create index if not exists merge_events_org_time_idx on public.merge_events (org_id, merged_at desc);