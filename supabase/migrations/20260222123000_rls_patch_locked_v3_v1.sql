begin;

-- =========================================================
-- rls_patch_locked_v3_v1
-- Align core table RLS with locked Dilly v3 org_users rules.
-- =========================================================

-- ---------- Helper functions (org_users based) ----------
create or replace function public.current_org_id_v3()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ou.org_id
  from public.org_users ou
  where ou.user_id = auth.uid()
  order by ou.created_at asc
  limit 1
$$;

create or replace function public.is_org_member_v3(p_org_id uuid)
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

create or replace function public.is_org_manager_or_admin_v3(p_org_id uuid)
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

create or replace function public.has_property_assignment_v3(p_org_id uuid, p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.property_assignments pa
    where pa.org_id = p_org_id
      and pa.property_id = p_property_id
      and pa.user_id = auth.uid()
  )
$$;

create or replace function public.has_opportunity_assignment_v3(p_org_id uuid, p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.opportunity_assignments oa
    where oa.org_id = p_org_id
      and oa.opportunity_id = p_opportunity_id
      and oa.user_id = auth.uid()
  )
$$;

revoke all on function public.current_org_id_v3() from public;
revoke all on function public.is_org_member_v3(uuid) from public;
revoke all on function public.is_org_manager_or_admin_v3(uuid) from public;
revoke all on function public.has_property_assignment_v3(uuid, uuid) from public;
revoke all on function public.has_opportunity_assignment_v3(uuid, uuid) from public;

grant execute on function public.current_org_id_v3() to authenticated;
grant execute on function public.is_org_member_v3(uuid) to authenticated;
grant execute on function public.is_org_manager_or_admin_v3(uuid) to authenticated;
grant execute on function public.has_property_assignment_v3(uuid, uuid) to authenticated;
grant execute on function public.has_opportunity_assignment_v3(uuid, uuid) to authenticated;

-- ---------- Ensure RLS enabled ----------
alter table if exists public.accounts enable row level security;
alter table if exists public.contacts enable row level security;
alter table if exists public.properties enable row level security;
alter table if exists public.opportunities enable row level security;
alter table if exists public.touchpoints enable row level security;
alter table if exists public.next_actions enable row level security;
alter table if exists public.property_assignments enable row level security;
alter table if exists public.opportunity_assignments enable row level security;

-- ---------- Drop existing policies on patched tables ----------
do $$
declare
  v_table text;
  v_policy record;
begin
  foreach v_table in array array[
    'accounts',
    'contacts',
    'properties',
    'opportunities',
    'touchpoints',
    'next_actions',
    'property_assignments',
    'opportunity_assignments'
  ]
  loop
    for v_policy in
      select p.policyname
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = v_table
    loop
      execute format(
        'drop policy if exists %I on public.%I',
        v_policy.policyname,
        v_table
      );
    end loop;
  end loop;
end $$;

-- ---------- accounts ----------
create policy accounts_select_org_member
on public.accounts
for select
to authenticated
using (public.is_org_member_v3(org_id));

create policy accounts_insert_my_org
on public.accounts
for insert
to authenticated
with check (
  org_id = public.current_org_id_v3()
  and (created_by is null or created_by = auth.uid())
);

create policy accounts_update_manager_or_creator
on public.accounts
for update
to authenticated
using (
  public.is_org_manager_or_admin_v3(org_id)
  or created_by = auth.uid()
)
with check (
  public.is_org_manager_or_admin_v3(org_id)
  or created_by = auth.uid()
);

create policy accounts_delete_manager_or_creator
on public.accounts
for delete
to authenticated
using (
  public.is_org_manager_or_admin_v3(org_id)
  or created_by = auth.uid()
);

-- ---------- contacts ----------
create policy contacts_select_org_member
on public.contacts
for select
to authenticated
using (public.is_org_member_v3(org_id));

create policy contacts_insert_my_org
on public.contacts
for insert
to authenticated
with check (
  org_id = public.current_org_id_v3()
  and (created_by is null or created_by = auth.uid())
);

create policy contacts_update_manager_or_creator
on public.contacts
for update
to authenticated
using (
  public.is_org_manager_or_admin_v3(org_id)
  or created_by = auth.uid()
)
with check (
  public.is_org_manager_or_admin_v3(org_id)
  or created_by = auth.uid()
);

create policy contacts_delete_manager_or_creator
on public.contacts
for delete
to authenticated
using (
  public.is_org_manager_or_admin_v3(org_id)
  or created_by = auth.uid()
);

-- ---------- properties ----------
create policy properties_select_org_member
on public.properties
for select
to authenticated
using (public.is_org_member_v3(org_id));

create policy properties_insert_my_org
on public.properties
for insert
to authenticated
with check (
  org_id = public.current_org_id_v3()
  and (created_by is null or created_by = auth.uid())
);

create policy properties_update_manager_creator_or_assigned
on public.properties
for update
to authenticated
using (
  public.is_org_manager_or_admin_v3(org_id)
  or created_by = auth.uid()
  or public.has_property_assignment_v3(org_id, id)
)
with check (
  public.is_org_manager_or_admin_v3(org_id)
  or created_by = auth.uid()
  or public.has_property_assignment_v3(org_id, id)
);

create policy properties_delete_manager_creator_or_assigned
on public.properties
for delete
to authenticated
using (
  public.is_org_manager_or_admin_v3(org_id)
  or created_by = auth.uid()
  or public.has_property_assignment_v3(org_id, id)
);

-- ---------- opportunities ----------
create policy opportunities_select_org_member
on public.opportunities
for select
to authenticated
using (public.is_org_member_v3(org_id));

create policy opportunities_insert_my_org
on public.opportunities
for insert
to authenticated
with check (
  org_id = public.current_org_id_v3()
  and (created_by is null or created_by = auth.uid())
);

create policy opportunities_update_manager_creator_or_assigned
on public.opportunities
for update
to authenticated
using (
  public.is_org_manager_or_admin_v3(org_id)
  or created_by = auth.uid()
  or public.has_opportunity_assignment_v3(org_id, id)
  or (property_id is not null and public.has_property_assignment_v3(org_id, property_id))
)
with check (
  public.is_org_manager_or_admin_v3(org_id)
  or created_by = auth.uid()
  or public.has_opportunity_assignment_v3(org_id, id)
  or (property_id is not null and public.has_property_assignment_v3(org_id, property_id))
);

create policy opportunities_delete_manager_creator_or_assigned
on public.opportunities
for delete
to authenticated
using (
  public.is_org_manager_or_admin_v3(org_id)
  or created_by = auth.uid()
  or public.has_opportunity_assignment_v3(org_id, id)
  or (property_id is not null and public.has_property_assignment_v3(org_id, property_id))
);

-- ---------- touchpoints ----------
create policy touchpoints_select_org_member
on public.touchpoints
for select
to authenticated
using (public.is_org_member_v3(org_id));

create policy touchpoints_insert_org_member
on public.touchpoints
for insert
to authenticated
with check (
  public.is_org_member_v3(org_id)
  and (created_by is null or created_by = auth.uid())
);

create policy touchpoints_no_update
on public.touchpoints
as restrictive
for update
to authenticated
using (false)
with check (false);

create policy touchpoints_no_delete
on public.touchpoints
as restrictive
for delete
to authenticated
using (false);

-- ---------- next_actions ----------
create policy next_actions_select_org_member
on public.next_actions
for select
to authenticated
using (public.is_org_member_v3(org_id));

create policy next_actions_insert_my_org
on public.next_actions
for insert
to authenticated
with check (
  org_id = public.current_org_id_v3()
  and (created_by is null or created_by = auth.uid())
);

create policy next_actions_update_assigned_creator_or_manager
on public.next_actions
for update
to authenticated
using (
  assigned_user_id = auth.uid()
  or created_by = auth.uid()
  or public.is_org_manager_or_admin_v3(org_id)
)
with check (
  assigned_user_id = auth.uid()
  or created_by = auth.uid()
  or public.is_org_manager_or_admin_v3(org_id)
);

create policy next_actions_delete_creator_or_manager
on public.next_actions
for delete
to authenticated
using (
  created_by = auth.uid()
  or public.is_org_manager_or_admin_v3(org_id)
);

-- ---------- property_assignments ----------
create policy property_assignments_select_org_member
on public.property_assignments
for select
to authenticated
using (public.is_org_member_v3(org_id));

create policy property_assignments_insert_my_org
on public.property_assignments
for insert
to authenticated
with check (
  org_id = public.current_org_id_v3()
  and (created_by is null or created_by = auth.uid())
);

create policy property_assignments_update_manager_or_creator
on public.property_assignments
for update
to authenticated
using (
  public.is_org_manager_or_admin_v3(org_id)
  or created_by = auth.uid()
)
with check (
  public.is_org_manager_or_admin_v3(org_id)
  or created_by = auth.uid()
);

create policy property_assignments_delete_manager_or_creator
on public.property_assignments
for delete
to authenticated
using (
  public.is_org_manager_or_admin_v3(org_id)
  or created_by = auth.uid()
);

-- ---------- opportunity_assignments ----------
create policy opportunity_assignments_select_org_member
on public.opportunity_assignments
for select
to authenticated
using (public.is_org_member_v3(org_id));

create policy opportunity_assignments_insert_my_org
on public.opportunity_assignments
for insert
to authenticated
with check (
  org_id = public.current_org_id_v3()
  and (created_by is null or created_by = auth.uid())
);

create policy opportunity_assignments_update_manager_or_creator
on public.opportunity_assignments
for update
to authenticated
using (
  public.is_org_manager_or_admin_v3(org_id)
  or created_by = auth.uid()
)
with check (
  public.is_org_manager_or_admin_v3(org_id)
  or created_by = auth.uid()
);

create policy opportunity_assignments_delete_manager_or_creator
on public.opportunity_assignments
for delete
to authenticated
using (
  public.is_org_manager_or_admin_v3(org_id)
  or created_by = auth.uid()
);

commit;
