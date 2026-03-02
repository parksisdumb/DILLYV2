begin;

-- =========================================================
-- rls_patch_locked_roofing_v1
-- Locked permission model:
-- - Org-wide read for org-scoped tables
-- - Edit only creator OR assigned OR manager/admin
-- - touchpoints + score_events are immutable ledgers (insert-only)
-- =========================================================

-- -------------------------
-- Helper predicates
-- -------------------------
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
    where ou.user_id = auth.uid()
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
    where ou.user_id = auth.uid()
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
    where pa.user_id = auth.uid()
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
    where oa.user_id = auth.uid()
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
    where self_ou.user_id = auth.uid()
      and self_ou.role in ('manager', 'admin')
      and target_ou.user_id = p_user_id
  )
$$;

revoke all on function public.rls_is_org_member(uuid) from public;
revoke all on function public.rls_is_manager_admin(uuid) from public;
revoke all on function public.rls_has_property_assignment(uuid) from public;
revoke all on function public.rls_has_opportunity_assignment(uuid) from public;
revoke all on function public.rls_is_manager_admin_for_user(uuid) from public;

grant execute on function public.rls_is_org_member(uuid) to authenticated;
grant execute on function public.rls_is_manager_admin(uuid) to authenticated;
grant execute on function public.rls_has_property_assignment(uuid) to authenticated;
grant execute on function public.rls_has_opportunity_assignment(uuid) to authenticated;
grant execute on function public.rls_is_manager_admin_for_user(uuid) to authenticated;

-- -------------------------
-- Ensure RLS enabled
-- -------------------------
alter table if exists public.accounts enable row level security;
alter table if exists public.contacts enable row level security;
alter table if exists public.properties enable row level security;
alter table if exists public.property_accounts enable row level security;
alter table if exists public.property_contacts enable row level security;
alter table if exists public.opportunities enable row level security;
alter table if exists public.opportunity_assignments enable row level security;
alter table if exists public.property_assignments enable row level security;
alter table if exists public.touchpoints enable row level security;
alter table if exists public.next_actions enable row level security;
alter table if exists public.score_rules enable row level security;
alter table if exists public.score_events enable row level security;
alter table if exists public.streaks enable row level security;
alter table if exists public.kpi_definitions enable row level security;
alter table if exists public.kpi_targets enable row level security;
alter table if exists public.milestone_types enable row level security;
alter table if exists public.opportunity_milestones enable row level security;
alter table if exists public.touchpoint_types enable row level security;
alter table if exists public.touchpoint_outcomes enable row level security;
alter table if exists public.opportunity_stages enable row level security;
alter table if exists public.scope_types enable row level security;
alter table if exists public.lost_reason_types enable row level security;
alter table if exists public.orgs enable row level security;
alter table if exists public.org_users enable row level security;
alter table if exists public.profiles enable row level security;

-- -------------------------
-- Drop existing policies on in-scope tables
-- -------------------------
do $$
declare
  v_table text;
  v_policy record;
begin
  foreach v_table in array array[
    'accounts',
    'contacts',
    'properties',
    'property_accounts',
    'property_contacts',
    'opportunities',
    'opportunity_assignments',
    'property_assignments',
    'touchpoints',
    'next_actions',
    'score_rules',
    'score_events',
    'streaks',
    'kpi_definitions',
    'kpi_targets',
    'milestone_types',
    'opportunity_milestones',
    'touchpoint_types',
    'touchpoint_outcomes',
    'opportunity_stages',
    'scope_types',
    'lost_reason_types',
    'orgs',
    'org_users',
    'profiles'
  ]
  loop
    for v_policy in
      select p.policyname
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = v_table
    loop
      execute format('drop policy if exists %I on public.%I', v_policy.policyname, v_table);
    end loop;
  end loop;
end $$;

-- -------------------------
-- orgs (read-only for members)
-- -------------------------
create policy orgs_select_member_locked
on public.orgs
for select
to authenticated
using (public.rls_is_org_member(id));

-- -------------------------
-- org_users
-- -------------------------
create policy org_users_select_member_locked
on public.org_users
for select
to authenticated
using (public.rls_is_org_member(org_id));

create policy org_users_insert_manager_admin_locked
on public.org_users
for insert
to authenticated
with check (public.rls_is_manager_admin(org_id));

create policy org_users_update_manager_admin_locked
on public.org_users
for update
to authenticated
using (public.rls_is_manager_admin(org_id))
with check (public.rls_is_manager_admin(org_id));

create policy org_users_delete_manager_admin_locked
on public.org_users
for delete
to authenticated
using (public.rls_is_manager_admin(org_id));

-- -------------------------
-- profiles
-- -------------------------
create policy profiles_select_self_or_manager_locked
on public.profiles
for select
to authenticated
using (
  user_id = auth.uid()
  or public.rls_is_manager_admin_for_user(user_id)
);

create policy profiles_insert_self_locked
on public.profiles
for insert
to authenticated
with check (user_id = auth.uid());

create policy profiles_update_self_or_manager_locked
on public.profiles
for update
to authenticated
using (
  user_id = auth.uid()
  or public.rls_is_manager_admin_for_user(user_id)
)
with check (
  user_id = auth.uid()
  or public.rls_is_manager_admin_for_user(user_id)
);

create policy profiles_delete_self_or_manager_locked
on public.profiles
for delete
to authenticated
using (
  user_id = auth.uid()
  or public.rls_is_manager_admin_for_user(user_id)
);

-- -------------------------
-- accounts
-- -------------------------
create policy accounts_select_member_locked
on public.accounts
for select
to authenticated
using (public.rls_is_org_member(org_id));

create policy accounts_insert_member_locked
on public.accounts
for insert
to authenticated
with check (public.rls_is_org_member(org_id));

create policy accounts_update_creator_or_manager_locked
on public.accounts
for update
to authenticated
using (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
with check (public.rls_is_manager_admin(org_id) or created_by = auth.uid());

create policy accounts_delete_creator_or_manager_locked
on public.accounts
for delete
to authenticated
using (public.rls_is_manager_admin(org_id) or created_by = auth.uid());

-- -------------------------
-- contacts
-- -------------------------
create policy contacts_select_member_locked
on public.contacts
for select
to authenticated
using (public.rls_is_org_member(org_id));

create policy contacts_insert_member_locked
on public.contacts
for insert
to authenticated
with check (public.rls_is_org_member(org_id));

create policy contacts_update_creator_or_manager_locked
on public.contacts
for update
to authenticated
using (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
with check (public.rls_is_manager_admin(org_id) or created_by = auth.uid());

create policy contacts_delete_creator_or_manager_locked
on public.contacts
for delete
to authenticated
using (public.rls_is_manager_admin(org_id) or created_by = auth.uid());

-- -------------------------
-- properties (assignment-aware edits)
-- -------------------------
create policy properties_select_member_locked
on public.properties
for select
to authenticated
using (public.rls_is_org_member(org_id));

create policy properties_insert_member_locked
on public.properties
for insert
to authenticated
with check (public.rls_is_org_member(org_id));

create policy properties_update_creator_assigned_or_manager_locked
on public.properties
for update
to authenticated
using (
  public.rls_is_manager_admin(org_id)
  or created_by = auth.uid()
  or public.rls_has_property_assignment(id)
)
with check (
  public.rls_is_manager_admin(org_id)
  or created_by = auth.uid()
  or public.rls_has_property_assignment(id)
);

create policy properties_delete_creator_assigned_or_manager_locked
on public.properties
for delete
to authenticated
using (
  public.rls_is_manager_admin(org_id)
  or created_by = auth.uid()
  or public.rls_has_property_assignment(id)
);

-- -------------------------
-- property_accounts
-- -------------------------
create policy property_accounts_select_member_locked
on public.property_accounts
for select
to authenticated
using (public.rls_is_org_member(org_id));

create policy property_accounts_insert_member_locked
on public.property_accounts
for insert
to authenticated
with check (public.rls_is_org_member(org_id));

create policy property_accounts_update_creator_or_manager_locked
on public.property_accounts
for update
to authenticated
using (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
with check (public.rls_is_manager_admin(org_id) or created_by = auth.uid());

create policy property_accounts_delete_creator_or_manager_locked
on public.property_accounts
for delete
to authenticated
using (public.rls_is_manager_admin(org_id) or created_by = auth.uid());

-- -------------------------
-- property_contacts
-- -------------------------
create policy property_contacts_select_member_locked
on public.property_contacts
for select
to authenticated
using (public.rls_is_org_member(org_id));

create policy property_contacts_insert_member_locked
on public.property_contacts
for insert
to authenticated
with check (public.rls_is_org_member(org_id));

create policy property_contacts_update_creator_or_manager_locked
on public.property_contacts
for update
to authenticated
using (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
with check (public.rls_is_manager_admin(org_id) or created_by = auth.uid());

create policy property_contacts_delete_creator_or_manager_locked
on public.property_contacts
for delete
to authenticated
using (public.rls_is_manager_admin(org_id) or created_by = auth.uid());

-- -------------------------
-- opportunities (assignment-aware edits)
-- -------------------------
create policy opportunities_select_member_locked
on public.opportunities
for select
to authenticated
using (public.rls_is_org_member(org_id));

create policy opportunities_insert_member_locked
on public.opportunities
for insert
to authenticated
with check (public.rls_is_org_member(org_id));

create policy opportunities_update_creator_assigned_or_manager_locked
on public.opportunities
for update
to authenticated
using (
  public.rls_is_manager_admin(org_id)
  or created_by = auth.uid()
  or public.rls_has_opportunity_assignment(id)
)
with check (
  public.rls_is_manager_admin(org_id)
  or created_by = auth.uid()
  or public.rls_has_opportunity_assignment(id)
);

create policy opportunities_delete_creator_assigned_or_manager_locked
on public.opportunities
for delete
to authenticated
using (
  public.rls_is_manager_admin(org_id)
  or created_by = auth.uid()
  or public.rls_has_opportunity_assignment(id)
);

-- -------------------------
-- property_assignments
-- -------------------------
create policy property_assignments_select_member_locked
on public.property_assignments
for select
to authenticated
using (public.rls_is_org_member(org_id));

create policy property_assignments_insert_member_locked
on public.property_assignments
for insert
to authenticated
with check (public.rls_is_org_member(org_id));

create policy property_assignments_update_creator_or_manager_locked
on public.property_assignments
for update
to authenticated
using (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
with check (public.rls_is_manager_admin(org_id) or created_by = auth.uid());

create policy property_assignments_delete_creator_or_manager_locked
on public.property_assignments
for delete
to authenticated
using (public.rls_is_manager_admin(org_id) or created_by = auth.uid());

-- -------------------------
-- opportunity_assignments
-- -------------------------
create policy opportunity_assignments_select_member_locked
on public.opportunity_assignments
for select
to authenticated
using (public.rls_is_org_member(org_id));

create policy opportunity_assignments_insert_member_locked
on public.opportunity_assignments
for insert
to authenticated
with check (public.rls_is_org_member(org_id));

create policy opportunity_assignments_update_creator_or_manager_locked
on public.opportunity_assignments
for update
to authenticated
using (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
with check (public.rls_is_manager_admin(org_id) or created_by = auth.uid());

create policy opportunity_assignments_delete_creator_or_manager_locked
on public.opportunity_assignments
for delete
to authenticated
using (public.rls_is_manager_admin(org_id) or created_by = auth.uid());

-- -------------------------
-- touchpoints (immutable ledger)
-- -------------------------
create policy touchpoints_select_member_locked
on public.touchpoints
for select
to authenticated
using (public.rls_is_org_member(org_id));

create policy touchpoints_insert_member_locked
on public.touchpoints
for insert
to authenticated
with check (public.rls_is_org_member(org_id));

-- -------------------------
-- next_actions (assigned-aware edits)
-- -------------------------
create policy next_actions_select_member_locked
on public.next_actions
for select
to authenticated
using (public.rls_is_org_member(org_id));

create policy next_actions_insert_member_locked
on public.next_actions
for insert
to authenticated
with check (public.rls_is_org_member(org_id));

create policy next_actions_update_creator_assigned_or_manager_locked
on public.next_actions
for update
to authenticated
using (
  public.rls_is_manager_admin(org_id)
  or created_by = auth.uid()
  or assigned_user_id = auth.uid()
)
with check (
  public.rls_is_manager_admin(org_id)
  or created_by = auth.uid()
  or assigned_user_id = auth.uid()
);

create policy next_actions_delete_creator_assigned_or_manager_locked
on public.next_actions
for delete
to authenticated
using (
  public.rls_is_manager_admin(org_id)
  or created_by = auth.uid()
  or assigned_user_id = auth.uid()
);

-- -------------------------
-- score_rules
-- -------------------------
create policy score_rules_select_member_or_global_locked
on public.score_rules
for select
to authenticated
using (org_id is null or public.rls_is_org_member(org_id));

create policy score_rules_insert_member_locked
on public.score_rules
for insert
to authenticated
with check (org_id is not null and public.rls_is_org_member(org_id));

create policy score_rules_update_creator_or_manager_locked
on public.score_rules
for update
to authenticated
using (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
)
with check (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
);

create policy score_rules_delete_creator_or_manager_locked
on public.score_rules
for delete
to authenticated
using (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
);

-- -------------------------
-- score_events (immutable ledger)
-- -------------------------
create policy score_events_select_member_locked
on public.score_events
for select
to authenticated
using (public.rls_is_org_member(org_id));

create policy score_events_insert_member_locked
on public.score_events
for insert
to authenticated
with check (public.rls_is_org_member(org_id));

-- -------------------------
-- streaks
-- -------------------------
create policy streaks_select_member_locked
on public.streaks
for select
to authenticated
using (public.rls_is_org_member(org_id));

create policy streaks_insert_member_locked
on public.streaks
for insert
to authenticated
with check (public.rls_is_org_member(org_id));

create policy streaks_update_manager_locked
on public.streaks
for update
to authenticated
using (public.rls_is_manager_admin(org_id))
with check (public.rls_is_manager_admin(org_id));

create policy streaks_delete_manager_locked
on public.streaks
for delete
to authenticated
using (public.rls_is_manager_admin(org_id));

-- -------------------------
-- kpi_definitions
-- -------------------------
create policy kpi_definitions_select_member_or_global_locked
on public.kpi_definitions
for select
to authenticated
using (org_id is null or public.rls_is_org_member(org_id));

create policy kpi_definitions_insert_member_locked
on public.kpi_definitions
for insert
to authenticated
with check (org_id is not null and public.rls_is_org_member(org_id));

create policy kpi_definitions_update_creator_or_manager_locked
on public.kpi_definitions
for update
to authenticated
using (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
)
with check (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
);

create policy kpi_definitions_delete_creator_or_manager_locked
on public.kpi_definitions
for delete
to authenticated
using (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
);

-- -------------------------
-- kpi_targets
-- -------------------------
create policy kpi_targets_select_member_locked
on public.kpi_targets
for select
to authenticated
using (public.rls_is_org_member(org_id));

create policy kpi_targets_insert_member_locked
on public.kpi_targets
for insert
to authenticated
with check (public.rls_is_org_member(org_id));

create policy kpi_targets_update_creator_or_manager_locked
on public.kpi_targets
for update
to authenticated
using (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
with check (public.rls_is_manager_admin(org_id) or created_by = auth.uid());

create policy kpi_targets_delete_creator_or_manager_locked
on public.kpi_targets
for delete
to authenticated
using (public.rls_is_manager_admin(org_id) or created_by = auth.uid());

-- -------------------------
-- milestone_types
-- -------------------------
create policy milestone_types_select_member_or_global_locked
on public.milestone_types
for select
to authenticated
using (org_id is null or public.rls_is_org_member(org_id));

create policy milestone_types_insert_member_locked
on public.milestone_types
for insert
to authenticated
with check (org_id is not null and public.rls_is_org_member(org_id));

create policy milestone_types_update_creator_or_manager_locked
on public.milestone_types
for update
to authenticated
using (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
)
with check (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
);

create policy milestone_types_delete_creator_or_manager_locked
on public.milestone_types
for delete
to authenticated
using (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
);

-- -------------------------
-- opportunity_milestones
-- -------------------------
create policy opportunity_milestones_select_member_locked
on public.opportunity_milestones
for select
to authenticated
using (public.rls_is_org_member(org_id));

create policy opportunity_milestones_insert_member_locked
on public.opportunity_milestones
for insert
to authenticated
with check (public.rls_is_org_member(org_id));

create policy opportunity_milestones_update_creator_or_manager_locked
on public.opportunity_milestones
for update
to authenticated
using (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
with check (public.rls_is_manager_admin(org_id) or created_by = auth.uid());

create policy opportunity_milestones_delete_creator_or_manager_locked
on public.opportunity_milestones
for delete
to authenticated
using (public.rls_is_manager_admin(org_id) or created_by = auth.uid());

-- -------------------------
-- touchpoint_types
-- -------------------------
create policy touchpoint_types_select_member_or_global_locked
on public.touchpoint_types
for select
to authenticated
using (org_id is null or public.rls_is_org_member(org_id));

create policy touchpoint_types_insert_member_locked
on public.touchpoint_types
for insert
to authenticated
with check (org_id is not null and public.rls_is_org_member(org_id));

create policy touchpoint_types_update_creator_or_manager_locked
on public.touchpoint_types
for update
to authenticated
using (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
)
with check (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
);

create policy touchpoint_types_delete_creator_or_manager_locked
on public.touchpoint_types
for delete
to authenticated
using (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
);

-- -------------------------
-- touchpoint_outcomes
-- -------------------------
create policy touchpoint_outcomes_select_member_or_global_locked
on public.touchpoint_outcomes
for select
to authenticated
using (org_id is null or public.rls_is_org_member(org_id));

create policy touchpoint_outcomes_insert_member_locked
on public.touchpoint_outcomes
for insert
to authenticated
with check (org_id is not null and public.rls_is_org_member(org_id));

create policy touchpoint_outcomes_update_creator_or_manager_locked
on public.touchpoint_outcomes
for update
to authenticated
using (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
)
with check (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
);

create policy touchpoint_outcomes_delete_creator_or_manager_locked
on public.touchpoint_outcomes
for delete
to authenticated
using (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
);

-- -------------------------
-- opportunity_stages
-- -------------------------
create policy opportunity_stages_select_member_or_global_locked
on public.opportunity_stages
for select
to authenticated
using (org_id is null or public.rls_is_org_member(org_id));

create policy opportunity_stages_insert_member_locked
on public.opportunity_stages
for insert
to authenticated
with check (org_id is not null and public.rls_is_org_member(org_id));

create policy opportunity_stages_update_creator_or_manager_locked
on public.opportunity_stages
for update
to authenticated
using (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
)
with check (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
);

create policy opportunity_stages_delete_creator_or_manager_locked
on public.opportunity_stages
for delete
to authenticated
using (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
);

-- -------------------------
-- scope_types
-- -------------------------
create policy scope_types_select_member_or_global_locked
on public.scope_types
for select
to authenticated
using (org_id is null or public.rls_is_org_member(org_id));

create policy scope_types_insert_member_locked
on public.scope_types
for insert
to authenticated
with check (org_id is not null and public.rls_is_org_member(org_id));

create policy scope_types_update_creator_or_manager_locked
on public.scope_types
for update
to authenticated
using (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
)
with check (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
);

create policy scope_types_delete_creator_or_manager_locked
on public.scope_types
for delete
to authenticated
using (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
);

-- -------------------------
-- lost_reason_types
-- -------------------------
create policy lost_reason_types_select_member_or_global_locked
on public.lost_reason_types
for select
to authenticated
using (org_id is null or public.rls_is_org_member(org_id));

create policy lost_reason_types_insert_member_locked
on public.lost_reason_types
for insert
to authenticated
with check (org_id is not null and public.rls_is_org_member(org_id));

create policy lost_reason_types_update_creator_or_manager_locked
on public.lost_reason_types
for update
to authenticated
using (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
)
with check (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
);

create policy lost_reason_types_delete_creator_or_manager_locked
on public.lost_reason_types
for delete
to authenticated
using (
  org_id is not null
  and (public.rls_is_manager_admin(org_id) or created_by = auth.uid())
);

commit;
