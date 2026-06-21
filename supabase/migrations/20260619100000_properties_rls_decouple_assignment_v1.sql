-- Decouple property edit/delete from dispatch assignment.
--
-- property_assignments is an OPERATIONAL DISPATCH label only — it must not grant
-- any access. But the current properties UPDATE/DELETE RLS (from the perf-audit
-- migration 20260323100000) granted edit/delete to assignees via
-- rls_has_property_assignment(id). This migration recreates those two policies
-- WITHOUT the assignment clause, so edit/delete is granted strictly by:
--   - rls_is_manager_admin(org_id)  → org member whose role is 'manager'/'admin', OR
--   - created_by = auth.uid()       → the person who created the property.
--
-- Unchanged: properties SELECT stays org-member-wide (reps still SEE every org
-- property, assigned or not). rls_has_property_assignment() is left intact — it is
-- still referenced by the opportunities UPDATE policy. No other table is touched.

begin;

-- UPDATE: manager/admin OR creator (assignee path removed)
drop policy if exists properties_update_creator_assigned_or_manager_locked on public.properties;
drop policy if exists properties_update_creator_or_manager_locked on public.properties;
create policy properties_update_creator_or_manager_locked on public.properties
  for update to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()))
  with check (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()));

-- DELETE: manager/admin OR creator (assignee path removed)
drop policy if exists properties_delete_creator_assigned_or_manager_locked on public.properties;
drop policy if exists properties_delete_creator_or_manager_locked on public.properties;
create policy properties_delete_creator_or_manager_locked on public.properties
  for delete to authenticated
  using (public.rls_is_manager_admin(org_id) or created_by = (select auth.uid()));

commit;
