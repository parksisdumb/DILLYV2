-- =========================================================
-- Dilly v2 - rls_policies_v1
-- Helper auth/access functions + RLS enablement + policies
-- =========================================================

-- -------------------------
-- 1) Helper functions (SECURITY DEFINER)
-- -------------------------
-- Note: These functions are SECURITY DEFINER so they can read memberships/roles
-- reliably under RLS and act as the single source of truth for access checks.

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.org_id
  from public.memberships m
  where m.user_id = auth.uid()
  order by m.created_at asc
  limit 1
$$;

create or replace function public.current_role_key(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.key
  from public.memberships m
  join public.roles r on r.id = m.role_id
  where m.user_id = auth.uid()
    and m.org_id = p_org_id
  limit 1
$$;

create or replace function public.is_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.org_id = p_org_id
  )
$$;

create or replace function public.is_manager(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_key(p_org_id) in ('manager','admin')
$$;

create or replace function public.is_admin(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_key(p_org_id) = 'admin'
$$;

create or replace function public.has_property_access(p_org_id uuid, p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_manager(p_org_id)
  or exists (
    select 1
    from public.property_assignments pa
    where pa.org_id = p_org_id
      and pa.property_id = p_property_id
      and pa.user_id = auth.uid()
  )
$$;

create or replace function public.has_opportunity_access(p_org_id uuid, p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_manager(p_org_id)
  or exists (
    select 1
    from public.opportunity_assignments oa
    where oa.org_id = p_org_id
      and oa.opportunity_id = p_opportunity_id
      and oa.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.opportunities o
    where o.org_id = p_org_id
      and o.id = p_opportunity_id
      and public.has_property_access(p_org_id, o.property_id)
  )
$$;

-- -------------------------
-- 2) Enable RLS
-- -------------------------
alter table public.orgs enable row level security;
alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.memberships enable row level security;

alter table public.accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.properties enable row level security;
alter table public.property_assignments enable row level security;

alter table public.scope_types enable row level security;
alter table public.opportunity_stages enable row level security;
alter table public.lost_reason_types enable row level security;

alter table public.opportunities enable row level security;
alter table public.opportunity_assignments enable row level security;

alter table public.touchpoint_types enable row level security;
alter table public.touchpoint_outcomes enable row level security;
alter table public.milestone_types enable row level security;

alter table public.touchpoints enable row level security;
alter table public.touchpoint_revisions enable row level security;

alter table public.opportunity_milestones enable row level security;
alter table public.next_actions enable row level security;

alter table public.kpi_definitions enable row level security;
alter table public.kpi_targets enable row level security;
alter table public.score_rules enable row level security;
alter table public.score_events enable row level security;
alter table public.streaks enable row level security;

alter table public.merge_events enable row level security;

-- -------------------------
-- 3) Policies
-- -------------------------

-- ===== ORGS =====
drop policy if exists orgs_select_member on public.orgs;
create policy orgs_select_member
on public.orgs
for select
to authenticated
using (public.is_member(id));

drop policy if exists orgs_update_admin on public.orgs;
create policy orgs_update_admin
on public.orgs
for update
to authenticated
using (public.is_admin(id))
with check (public.is_admin(id));

-- Allow org creation via RPC later; keep direct insert locked down.
drop policy if exists orgs_insert_none on public.orgs;
create policy orgs_insert_none
on public.orgs
for insert
to authenticated
with check (false);

-- ===== PROFILES =====
drop policy if exists profiles_select_self_or_manager on public.profiles;
create policy profiles_select_self_or_manager
on public.profiles
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.memberships m
    where m.user_id = public.profiles.user_id
      and public.is_manager(m.org_id)
  )
);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- ===== ROLES =====
drop policy if exists roles_select_defaults_and_org on public.roles;
create policy roles_select_defaults_and_org
on public.roles
for select
to authenticated
using (
  org_id is null
  or public.is_member(org_id)
);

drop policy if exists roles_write_admin_only on public.roles;
create policy roles_write_admin_only
on public.roles
for all
to authenticated
using (org_id is not null and public.is_admin(org_id))
with check (org_id is not null and public.is_admin(org_id));

-- ===== MEMBERSHIPS =====
drop policy if exists memberships_select_self_or_manager on public.memberships;
create policy memberships_select_self_or_manager
on public.memberships
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_manager(org_id)
);

drop policy if exists memberships_write_admin_only on public.memberships;
create policy memberships_write_admin_only
on public.memberships
for all
to authenticated
using (public.is_admin(org_id))
with check (public.is_admin(org_id));

-- ===== ACCOUNTS =====
drop policy if exists accounts_select_via_property_access_or_manager on public.accounts;
create policy accounts_select_via_property_access_or_manager
on public.accounts
for select
to authenticated
using (
  public.is_manager(org_id)
  or created_by = auth.uid()
  or exists (
    select 1
    from public.properties p
    where p.org_id = public.accounts.org_id
      and p.primary_account_id = public.accounts.id
      and public.has_property_access(p.org_id, p.id)
  )
);

drop policy if exists accounts_insert_member on public.accounts;
create policy accounts_insert_member
on public.accounts
for insert
to authenticated
with check (
  org_id = public.current_org_id()
  and created_by = auth.uid()
);

drop policy if exists accounts_update_manager_or_creator on public.accounts;
create policy accounts_update_manager_or_creator
on public.accounts
for update
to authenticated
using (public.is_manager(org_id) or created_by = auth.uid())
with check (public.is_manager(org_id) or created_by = auth.uid());

-- ===== CONTACTS =====
drop policy if exists contacts_select_via_property_access_or_manager on public.contacts;
create policy contacts_select_via_property_access_or_manager
on public.contacts
for select
to authenticated
using (
  public.is_manager(org_id)
  or created_by = auth.uid()
  or exists (
    select 1
    from public.properties p
    where p.org_id = public.contacts.org_id
      and p.primary_contact_id = public.contacts.id
      and public.has_property_access(p.org_id, p.id)
  )
);

drop policy if exists contacts_insert_member on public.contacts;
create policy contacts_insert_member
on public.contacts
for insert
to authenticated
with check (
  org_id = public.current_org_id()
  and created_by = auth.uid()
);

drop policy if exists contacts_update_manager_or_creator on public.contacts;
create policy contacts_update_manager_or_creator
on public.contacts
for update
to authenticated
using (public.is_manager(org_id) or created_by = auth.uid())
with check (public.is_manager(org_id) or created_by = auth.uid());

-- ===== PROPERTIES =====
drop policy if exists properties_select_assigned_or_manager on public.properties;
create policy properties_select_assigned_or_manager
on public.properties
for select
to authenticated
using (public.has_property_access(org_id, id));

drop policy if exists properties_insert_member on public.properties;
create policy properties_insert_member
on public.properties
for insert
to authenticated
with check (
  org_id = public.current_org_id()
  and created_by = auth.uid()
);

drop policy if exists properties_update_assigned_or_manager on public.properties;
create policy properties_update_assigned_or_manager
on public.properties
for update
to authenticated
using (public.has_property_access(org_id, id))
with check (public.has_property_access(org_id, id));

-- ===== PROPERTY ASSIGNMENTS =====
drop policy if exists property_assignments_select on public.property_assignments;
create policy property_assignments_select
on public.property_assignments
for select
to authenticated
using (
  public.is_manager(org_id)
  or user_id = auth.uid()
  or public.has_property_access(org_id, property_id)
);

-- write via RPC (manager/admin only for direct table ops)
drop policy if exists property_assignments_write_manager_only on public.property_assignments;
create policy property_assignments_write_manager_only
on public.property_assignments
for all
to authenticated
using (public.is_manager(org_id))
with check (public.is_manager(org_id));

-- ===== CONFIG TABLES (scope_types, stages, milestone_types, touchpoint_types, outcomes, lost reasons) =====
-- Everyone in org can read defaults + org overrides
drop policy if exists scope_types_select on public.scope_types;
create policy scope_types_select
on public.scope_types
for select
to authenticated
using (org_id is null or public.is_member(org_id));

drop policy if exists scope_types_write_admin on public.scope_types;
create policy scope_types_write_admin
on public.scope_types
for all
to authenticated
using (org_id is not null and public.is_admin(org_id))
with check (org_id is not null and public.is_admin(org_id));

drop policy if exists opportunity_stages_select on public.opportunity_stages;
create policy opportunity_stages_select
on public.opportunity_stages
for select
to authenticated
using (org_id is null or public.is_member(org_id));

drop policy if exists opportunity_stages_write_admin on public.opportunity_stages;
create policy opportunity_stages_write_admin
on public.opportunity_stages
for all
to authenticated
using (org_id is not null and public.is_admin(org_id))
with check (org_id is not null and public.is_admin(org_id));

drop policy if exists milestone_types_select on public.milestone_types;
create policy milestone_types_select
on public.milestone_types
for select
to authenticated
using (org_id is null or public.is_member(org_id));

drop policy if exists milestone_types_write_admin on public.milestone_types;
create policy milestone_types_write_admin
on public.milestone_types
for all
to authenticated
using (org_id is not null and public.is_admin(org_id))
with check (org_id is not null and public.is_admin(org_id));

drop policy if exists touchpoint_types_select on public.touchpoint_types;
create policy touchpoint_types_select
on public.touchpoint_types
for select
to authenticated
using (org_id is null or public.is_member(org_id));

drop policy if exists touchpoint_types_write_admin on public.touchpoint_types;
create policy touchpoint_types_write_admin
on public.touchpoint_types
for all
to authenticated
using (org_id is not null and public.is_admin(org_id))
with check (org_id is not null and public.is_admin(org_id));

drop policy if exists touchpoint_outcomes_select on public.touchpoint_outcomes;
create policy touchpoint_outcomes_select
on public.touchpoint_outcomes
for select
to authenticated
using (org_id is null or public.is_member(org_id));

drop policy if exists touchpoint_outcomes_write_admin on public.touchpoint_outcomes;
create policy touchpoint_outcomes_write_admin
on public.touchpoint_outcomes
for all
to authenticated
using (org_id is not null and public.is_admin(org_id))
with check (org_id is not null and public.is_admin(org_id));

drop policy if exists lost_reason_types_select on public.lost_reason_types;
create policy lost_reason_types_select
on public.lost_reason_types
for select
to authenticated
using (org_id is null or public.is_member(org_id));

drop policy if exists lost_reason_types_write_admin on public.lost_reason_types;
create policy lost_reason_types_write_admin
on public.lost_reason_types
for all
to authenticated
using (org_id is not null and public.is_admin(org_id))
with check (org_id is not null and public.is_admin(org_id));

-- ===== OPPORTUNITIES =====
drop policy if exists opportunities_select on public.opportunities;
create policy opportunities_select
on public.opportunities
for select
to authenticated
using (public.has_opportunity_access(org_id, id));

drop policy if exists opportunities_insert on public.opportunities;
create policy opportunities_insert
on public.opportunities
for insert
to authenticated
with check (
  org_id = public.current_org_id()
  and created_by = auth.uid()
  and public.has_property_access(org_id, property_id)
);

drop policy if exists opportunities_update on public.opportunities;
create policy opportunities_update
on public.opportunities
for update
to authenticated
using (public.has_opportunity_access(org_id, id))
with check (public.has_opportunity_access(org_id, id));

-- ===== OPPORTUNITY ASSIGNMENTS =====
drop policy if exists opportunity_assignments_select on public.opportunity_assignments;
create policy opportunity_assignments_select
on public.opportunity_assignments
for select
to authenticated
using (
  public.is_manager(org_id)
  or user_id = auth.uid()
  or public.has_opportunity_access(org_id, opportunity_id)
);

drop policy if exists opportunity_assignments_write_manager_only on public.opportunity_assignments;
create policy opportunity_assignments_write_manager_only
on public.opportunity_assignments
for all
to authenticated
using (public.is_manager(org_id))
with check (public.is_manager(org_id));

-- ===== TOUCHPOINTS =====
drop policy if exists touchpoints_select on public.touchpoints;
create policy touchpoints_select
on public.touchpoints
for select
to authenticated
using (
  public.is_manager(org_id)
  or rep_user_id = auth.uid()
  or public.has_property_access(org_id, property_id)
  or (opportunity_id is not null and public.has_opportunity_access(org_id, opportunity_id))
);

drop policy if exists touchpoints_insert on public.touchpoints;
create policy touchpoints_insert
on public.touchpoints
for insert
to authenticated
with check (
  org_id = public.current_org_id()
  and created_by = auth.uid()
  and rep_user_id = auth.uid()
  and public.has_property_access(org_id, property_id)
  and (opportunity_id is null or public.has_opportunity_access(org_id, opportunity_id))
);

-- Updates: managers only (edits should be audited via rpc in migration 3)
drop policy if exists touchpoints_update_manager_only on public.touchpoints;
create policy touchpoints_update_manager_only
on public.touchpoints
for update
to authenticated
using (public.is_manager(org_id))
with check (public.is_manager(org_id));

-- ===== TOUCHPOINT REVISIONS =====
drop policy if exists touchpoint_revisions_select_manager on public.touchpoint_revisions;
create policy touchpoint_revisions_select_manager
on public.touchpoint_revisions
for select
to authenticated
using (public.is_manager(org_id));

drop policy if exists touchpoint_revisions_insert_manager on public.touchpoint_revisions;
create policy touchpoint_revisions_insert_manager
on public.touchpoint_revisions
for insert
to authenticated
with check (public.is_manager(org_id));

-- ===== OPPORTUNITY MILESTONES =====
drop policy if exists opportunity_milestones_select on public.opportunity_milestones;
create policy opportunity_milestones_select
on public.opportunity_milestones
for select
to authenticated
using (public.has_opportunity_access(org_id, opportunity_id));

drop policy if exists opportunity_milestones_write on public.opportunity_milestones;
create policy opportunity_milestones_write
on public.opportunity_milestones
for insert
to authenticated
with check (
  org_id = public.current_org_id()
  and public.has_opportunity_access(org_id, opportunity_id)
);

-- ===== NEXT ACTIONS =====
drop policy if exists next_actions_select on public.next_actions;
create policy next_actions_select
on public.next_actions
for select
to authenticated
using (
  public.is_manager(org_id)
  or assigned_user_id = auth.uid()
  or created_by = auth.uid()
  or public.has_property_access(org_id, property_id)
  or (opportunity_id is not null and public.has_opportunity_access(org_id, opportunity_id))
);

drop policy if exists next_actions_insert on public.next_actions;
create policy next_actions_insert
on public.next_actions
for insert
to authenticated
with check (
  org_id = public.current_org_id()
  and created_by = auth.uid()
  and public.has_property_access(org_id, property_id)
);

drop policy if exists next_actions_update_assigned_or_manager on public.next_actions;
create policy next_actions_update_assigned_or_manager
on public.next_actions
for update
to authenticated
using (public.is_manager(org_id) or assigned_user_id = auth.uid())
with check (public.is_manager(org_id) or assigned_user_id = auth.uid());

-- ===== KPI + SCORING =====
drop policy if exists kpi_definitions_select on public.kpi_definitions;
create policy kpi_definitions_select
on public.kpi_definitions
for select
to authenticated
using (org_id is null or public.is_member(org_id));

drop policy if exists kpi_definitions_write_admin on public.kpi_definitions;
create policy kpi_definitions_write_admin
on public.kpi_definitions
for all
to authenticated
using (org_id is not null and public.is_admin(org_id))
with check (org_id is not null and public.is_admin(org_id));

drop policy if exists kpi_targets_select on public.kpi_targets;
create policy kpi_targets_select
on public.kpi_targets
for select
to authenticated
using (
  public.is_manager(org_id)
  or user_id = auth.uid()
);

drop policy if exists kpi_targets_write_manager on public.kpi_targets;
create policy kpi_targets_write_manager
on public.kpi_targets
for all
to authenticated
using (public.is_manager(org_id))
with check (public.is_manager(org_id));

drop policy if exists score_rules_select on public.score_rules;
create policy score_rules_select
on public.score_rules
for select
to authenticated
using (org_id is null or public.is_member(org_id));

drop policy if exists score_rules_write_admin on public.score_rules;
create policy score_rules_write_admin
on public.score_rules
for all
to authenticated
using (org_id is not null and public.is_admin(org_id))
with check (org_id is not null and public.is_admin(org_id));

drop policy if exists score_events_select on public.score_events;
create policy score_events_select
on public.score_events
for select
to authenticated
using (public.is_manager(org_id) or user_id = auth.uid());

-- insert via rpc (but allow insert for now if it matches user)
drop policy if exists score_events_insert_self on public.score_events;
create policy score_events_insert_self
on public.score_events
for insert
to authenticated
with check (org_id = public.current_org_id() and user_id = auth.uid());

drop policy if exists streaks_select on public.streaks;
create policy streaks_select
on public.streaks
for select
to authenticated
using (public.is_manager(org_id) or user_id = auth.uid());

drop policy if exists streaks_write_manager on public.streaks;
create policy streaks_write_manager
on public.streaks
for all
to authenticated
using (public.is_manager(org_id))
with check (public.is_manager(org_id));

-- ===== MERGE EVENTS =====
drop policy if exists merge_events_select_manager on public.merge_events;
create policy merge_events_select_manager
on public.merge_events
for select
to authenticated
using (public.is_manager(org_id));

drop policy if exists merge_events_insert_manager on public.merge_events;
create policy merge_events_insert_manager
on public.merge_events
for insert
to authenticated
with check (public.is_manager(org_id));
