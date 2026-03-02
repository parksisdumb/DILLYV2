begin;

drop policy if exists kpi_targets_insert_member_locked on public.kpi_targets;
drop policy if exists kpi_targets_update_creator_or_manager_locked on public.kpi_targets;
drop policy if exists kpi_targets_delete_creator_or_manager_locked on public.kpi_targets;

create policy kpi_targets_insert_manager_admin_locked
on public.kpi_targets
for insert
to authenticated
with check (public.rls_is_manager_admin(org_id));

create policy kpi_targets_update_manager_admin_locked
on public.kpi_targets
for update
to authenticated
using (public.rls_is_manager_admin(org_id))
with check (public.rls_is_manager_admin(org_id));

create policy kpi_targets_delete_manager_admin_locked
on public.kpi_targets
for delete
to authenticated
using (public.rls_is_manager_admin(org_id));

commit;
