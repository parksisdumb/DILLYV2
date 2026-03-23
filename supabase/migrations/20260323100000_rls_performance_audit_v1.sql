-- RLS Performance Audit
-- 1. Wrap auth.uid() in (SELECT auth.uid()) inside RLS helper functions
-- 2. Recreate policies that use auth.uid() directly with the optimized pattern
-- 3. Add missing indexes on created_by columns used in RLS policies
-- 4. Confirm intel_prospects, reit_universe, agent_registry have RLS disabled

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 1: Optimize RLS helper functions
-- Wrapping auth.uid() in (SELECT auth.uid()) prevents per-row re-evaluation
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.rls_is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_users ou
    where ou.user_id = (select auth.uid())
      and ou.org_id = p_org_id
  )
$$;

create or replace function public.rls_is_manager_admin(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_users ou
    where ou.user_id = (select auth.uid())
      and ou.org_id = p_org_id
      and ou.role in ('manager', 'admin')
  )
$$;

create or replace function public.rls_has_property_assignment(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.property_assignments pa
    where pa.user_id = (select auth.uid())
      and pa.property_id = p_property_id
  )
$$;

create or replace function public.rls_has_opportunity_assignment(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.opportunity_assignments oa
    where oa.user_id = (select auth.uid())
      and oa.opportunity_id = p_opportunity_id
  )
$$;

create or replace function public.rls_is_manager_admin_for_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_users self_ou
    join public.org_users target_ou
      on target_ou.org_id = self_ou.org_id
    where self_ou.user_id = (select auth.uid())
      and self_ou.role in ('manager', 'admin')
      and target_ou.user_id = p_user_id
  )
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 2: Recreate policies that use auth.uid() directly
-- These policies bypass the helper functions and call auth.uid() inline
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── profiles ─────────────────────────────────────────────────────────────────

drop policy if exists profiles_select_self_or_manager_locked on public.profiles;
create policy profiles_select_self_or_manager_locked on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or public.rls_is_manager_admin_for_user(user_id));

drop policy if exists profiles_insert_self_locked on public.profiles;
create policy profiles_insert_self_locked on public.profiles
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists profiles_update_self_or_manager_locked on public.profiles;
create policy profiles_update_self_or_manager_locked on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()) or public.rls_is_manager_admin_for_user(user_id))
  with check (user_id = (select auth.uid()) or public.rls_is_manager_admin_for_user(user_id));

drop policy if exists profiles_delete_self_or_manager_locked on public.profiles;
create policy profiles_delete_self_or_manager_locked on public.profiles
  for delete to authenticated
  using (user_id = (select auth.uid()) or public.rls_is_manager_admin_for_user(user_id));

-- ── accounts (created_by = auth.uid()) ───────────────────────────────────────

drop policy if exists accounts_update_creator_or_manager_locked on public.accounts;
create policy accounts_update_creator_or_manager_locked on public.accounts
  for update to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()))
  with check (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()));

drop policy if exists accounts_delete_creator_or_manager_locked on public.accounts;
create policy accounts_delete_creator_or_manager_locked on public.accounts
  for delete to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()));

-- ── contacts (created_by = auth.uid()) ───────────────────────────────────────

drop policy if exists contacts_update_creator_or_manager_locked on public.contacts;
create policy contacts_update_creator_or_manager_locked on public.contacts
  for update to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()))
  with check (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()));

drop policy if exists contacts_delete_creator_or_manager_locked on public.contacts;
create policy contacts_delete_creator_or_manager_locked on public.contacts
  for delete to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()));

-- ── properties (created_by = auth.uid()) ─────────────────────────────────────

drop policy if exists properties_update_creator_assigned_or_manager_locked on public.properties;
create policy properties_update_creator_assigned_or_manager_locked on public.properties
  for update to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()) or public.rls_has_property_assignment(id))
  with check (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()) or public.rls_has_property_assignment(id));

drop policy if exists properties_delete_creator_assigned_or_manager_locked on public.properties;
create policy properties_delete_creator_assigned_or_manager_locked on public.properties
  for delete to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()) or public.rls_has_property_assignment(id));

-- ── opportunities (created_by = auth.uid()) ──────────────────────────────────

drop policy if exists opportunities_update_creator_assigned_or_manager_locked on public.opportunities;
create policy opportunities_update_creator_assigned_or_manager_locked on public.opportunities
  for update to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()) or public.rls_has_opportunity_assignment(id) or (property_id is not null and public.rls_has_property_assignment(property_id)))
  with check (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()) or public.rls_has_opportunity_assignment(id) or (property_id is not null and public.rls_has_property_assignment(property_id)));

drop policy if exists opportunities_delete_creator_assigned_or_manager_locked on public.opportunities;
create policy opportunities_delete_creator_assigned_or_manager_locked on public.opportunities
  for delete to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()) or public.rls_has_opportunity_assignment(id) or (property_id is not null and public.rls_has_property_assignment(property_id)));

-- ── property_accounts (created_by = auth.uid()) ─────────────────────────────

drop policy if exists property_accounts_update_creator_or_manager_locked on public.property_accounts;
create policy property_accounts_update_creator_or_manager_locked on public.property_accounts
  for update to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()))
  with check (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()));

drop policy if exists property_accounts_delete_creator_or_manager_locked on public.property_accounts;
create policy property_accounts_delete_creator_or_manager_locked on public.property_accounts
  for delete to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()));

-- ── property_contacts (created_by = auth.uid()) ─────────────────────────────

drop policy if exists property_contacts_update_creator_or_manager_locked on public.property_contacts;
create policy property_contacts_update_creator_or_manager_locked on public.property_contacts
  for update to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()))
  with check (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()));

drop policy if exists property_contacts_delete_creator_or_manager_locked on public.property_contacts;
create policy property_contacts_delete_creator_or_manager_locked on public.property_contacts
  for delete to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()));

-- ── property_assignments (created_by = auth.uid()) ──────────────────────────

drop policy if exists property_assignments_update_creator_or_manager_locked on public.property_assignments;
create policy property_assignments_update_creator_or_manager_locked on public.property_assignments
  for update to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()))
  with check (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()));

drop policy if exists property_assignments_delete_creator_or_manager_locked on public.property_assignments;
create policy property_assignments_delete_creator_or_manager_locked on public.property_assignments
  for delete to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()));

-- ── opportunity_assignments (created_by = auth.uid()) ────────────────────────

drop policy if exists opportunity_assignments_update_creator_or_manager_locked on public.opportunity_assignments;
create policy opportunity_assignments_update_creator_or_manager_locked on public.opportunity_assignments
  for update to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()))
  with check (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()));

drop policy if exists opportunity_assignments_delete_creator_or_manager_locked on public.opportunity_assignments;
create policy opportunity_assignments_delete_creator_or_manager_locked on public.opportunity_assignments
  for delete to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()));

-- ── next_actions (created_by + assigned_user_id = auth.uid()) ────────────────

drop policy if exists next_actions_update_creator_assigned_or_manager_locked on public.next_actions;
create policy next_actions_update_creator_assigned_or_manager_locked on public.next_actions
  for update to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()) or assigned_user_id = (select auth.uid()))
  with check (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()) or assigned_user_id = (select auth.uid()));

drop policy if exists next_actions_delete_creator_or_manager_locked on public.next_actions;
create policy next_actions_delete_creator_or_manager_locked on public.next_actions
  for delete to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()) or assigned_user_id = (select auth.uid()));

-- ── score_rules (created_by = auth.uid()) ────────────────────────────────────

drop policy if exists score_rules_update_creator_or_manager_locked on public.score_rules;
create policy score_rules_update_creator_or_manager_locked on public.score_rules
  for update to authenticated
  using (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())))
  with check (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())));

drop policy if exists score_rules_delete_creator_or_manager_locked on public.score_rules;
create policy score_rules_delete_creator_or_manager_locked on public.score_rules
  for delete to authenticated
  using (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())));

-- ── kpi_definitions (created_by = auth.uid()) ────────────────────────────────

drop policy if exists kpi_definitions_update_creator_or_manager_locked on public.kpi_definitions;
create policy kpi_definitions_update_creator_or_manager_locked on public.kpi_definitions
  for update to authenticated
  using (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())))
  with check (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())));

drop policy if exists kpi_definitions_delete_creator_or_manager_locked on public.kpi_definitions;
create policy kpi_definitions_delete_creator_or_manager_locked on public.kpi_definitions
  for delete to authenticated
  using (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())));

-- ── kpi_targets (created_by = auth.uid()) ────────────────────────────────────

drop policy if exists kpi_targets_update_creator_or_manager_locked on public.kpi_targets;
-- Note: kpi_targets_update_manager_admin_locked may exist from migration 20260225220000
drop policy if exists kpi_targets_update_manager_admin_locked on public.kpi_targets;
create policy kpi_targets_update_manager_admin_locked on public.kpi_targets
  for update to authenticated
  using (public.rls_is_manager_admin(org_id))
  with check (public.rls_is_manager_admin(org_id));

-- ── milestone_types (created_by = auth.uid()) ───────────────────────────────

drop policy if exists milestone_types_update_creator_or_manager_locked on public.milestone_types;
create policy milestone_types_update_creator_or_manager_locked on public.milestone_types
  for update to authenticated
  using (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())))
  with check (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())));

drop policy if exists milestone_types_delete_creator_or_manager_locked on public.milestone_types;
create policy milestone_types_delete_creator_or_manager_locked on public.milestone_types
  for delete to authenticated
  using (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())));

-- ── opportunity_milestones (created_by = auth.uid()) ─────────────────────────

drop policy if exists opportunity_milestones_update_creator_or_manager_locked on public.opportunity_milestones;
create policy opportunity_milestones_update_creator_or_manager_locked on public.opportunity_milestones
  for update to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()))
  with check (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()));

drop policy if exists opportunity_milestones_delete_creator_or_manager_locked on public.opportunity_milestones;
create policy opportunity_milestones_delete_creator_or_manager_locked on public.opportunity_milestones
  for delete to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()));

-- ── touchpoint_types (created_by = auth.uid()) ──────────────────────────────

drop policy if exists touchpoint_types_update_creator_or_manager_locked on public.touchpoint_types;
create policy touchpoint_types_update_creator_or_manager_locked on public.touchpoint_types
  for update to authenticated
  using (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())))
  with check (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())));

drop policy if exists touchpoint_types_delete_creator_or_manager_locked on public.touchpoint_types;
create policy touchpoint_types_delete_creator_or_manager_locked on public.touchpoint_types
  for delete to authenticated
  using (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())));

-- ── touchpoint_outcomes (created_by = auth.uid()) ────────────────────────────

drop policy if exists touchpoint_outcomes_update_creator_or_manager_locked on public.touchpoint_outcomes;
create policy touchpoint_outcomes_update_creator_or_manager_locked on public.touchpoint_outcomes
  for update to authenticated
  using (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())))
  with check (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())));

drop policy if exists touchpoint_outcomes_delete_creator_or_manager_locked on public.touchpoint_outcomes;
create policy touchpoint_outcomes_delete_creator_or_manager_locked on public.touchpoint_outcomes
  for delete to authenticated
  using (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())));

-- ── opportunity_stages (created_by = auth.uid()) ─────────────────────────────

drop policy if exists opportunity_stages_update_creator_or_manager_locked on public.opportunity_stages;
create policy opportunity_stages_update_creator_or_manager_locked on public.opportunity_stages
  for update to authenticated
  using (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())))
  with check (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())));

drop policy if exists opportunity_stages_delete_creator_or_manager_locked on public.opportunity_stages;
create policy opportunity_stages_delete_creator_or_manager_locked on public.opportunity_stages
  for delete to authenticated
  using (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())));

-- ── scope_types (created_by = auth.uid()) ────────────────────────────────────

drop policy if exists scope_types_update_creator_or_manager_locked on public.scope_types;
create policy scope_types_update_creator_or_manager_locked on public.scope_types
  for update to authenticated
  using (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())))
  with check (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())));

drop policy if exists scope_types_delete_creator_or_manager_locked on public.scope_types;
create policy scope_types_delete_creator_or_manager_locked on public.scope_types
  for delete to authenticated
  using (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())));

-- ── lost_reason_types (created_by = auth.uid()) ─────────────────────────────

drop policy if exists lost_reason_types_update_creator_or_manager_locked on public.lost_reason_types;
create policy lost_reason_types_update_creator_or_manager_locked on public.lost_reason_types
  for update to authenticated
  using (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())))
  with check (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())));

drop policy if exists lost_reason_types_delete_creator_or_manager_locked on public.lost_reason_types;
create policy lost_reason_types_delete_creator_or_manager_locked on public.lost_reason_types
  for delete to authenticated
  using (org_id is not null and (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid())));

-- ── suggested_outreach (user_id = auth.uid()) ────────────────────────────────

drop policy if exists suggested_outreach_update_own on public.suggested_outreach;
create policy suggested_outreach_update_own on public.suggested_outreach
  for update to authenticated
  using (user_id = (select auth.uid()));

-- ── benchmark_snapshots (auth.uid() in subquery) ─────────────────────────────

drop policy if exists benchmark_snapshots_read_org on public.benchmark_snapshots;
create policy benchmark_snapshots_read_org on public.benchmark_snapshots
  for select to authenticated
  using (org_id is not null and exists (
    select 1 from public.org_users ou
    where ou.org_id = benchmark_snapshots.org_id
      and ou.user_id = (select auth.uid())
  ));

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 3: Missing indexes on columns used in RLS policies
-- created_by is checked in UPDATE/DELETE policies for many tables
-- ═══════════════════════════════════════════════════════════════════════════════

create index if not exists accounts_created_by_idx on public.accounts (created_by);
create index if not exists contacts_created_by_idx on public.contacts (created_by);
create index if not exists properties_created_by_idx on public.properties (created_by);
create index if not exists opportunities_created_by_idx on public.opportunities (created_by);
create index if not exists next_actions_created_by_idx on public.next_actions (created_by);
create index if not exists touchpoints_created_by_idx on public.touchpoints (created_by);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 4: Confirm RLS disabled on service-role-only tables
-- These tables should NOT have RLS enabled (accessed via createAdminClient only)
-- ═══════════════════════════════════════════════════════════════════════════════

alter table if exists public.intel_prospects disable row level security;
alter table if exists public.reit_universe disable row level security;
alter table if exists public.agent_registry disable row level security;
