-- rpc_merge_property_v1
--
-- Manager/admin tool to merge a duplicate property (source) into a surviving
-- property. Commercial-property data arrives from many sources (manual entry,
-- CSV import, intel/discover feeds, prospect conversion) with no dedup, so the
-- same building shows up twice ("Bardin Greene Apartments" vs "Bardin Greene",
-- "300 Bardin Greene Dr"). This atomically re-points every child row from the
-- source to the survivor, then soft-deletes the source and records the merge.
--
-- Child tables reparented by property_id: opportunities, touchpoints,
-- next_actions, property_contacts, property_assignments, property_accounts.
-- Tables with a uniqueness constraint (property_contacts PK, property_assignments
-- unique, property_accounts logical key) reparent ON CONFLICT-skip: rows that
-- would collide with an existing survivor row are dropped instead of duplicated.
--
-- SECURITY DEFINER: intentionally bypasses the touchpoints insert-only RLS so the
-- immutable ledger can be re-parented during an administrative merge. This is the
-- sanctioned path — reps cannot update touchpoints directly.
--
-- NOTE: like all migrations in this repo, this must be applied to prod manually
-- (prod `db push` is blocked for the local CLI account). Until applied, the app's
-- merge button degrades gracefully with a "function not found" error.

begin;

create or replace function public.rpc_merge_property(
  p_source_id uuid,
  p_survivor_id uuid,
  p_notes text default null
)
returns public.properties
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_role text;
  v_source public.properties;
  v_survivor public.properties;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_source_id is null or p_survivor_id is null then
    raise exception 'Both source and survivor property ids are required';
  end if;

  if p_source_id = p_survivor_id then
    raise exception 'Cannot merge a property into itself';
  end if;

  select m.org_id, m.role into v_org_id, v_role
  from public.rpc_get_my_org() m;

  if v_role not in ('manager', 'admin') then
    raise exception 'Only managers or admins can merge properties';
  end if;

  -- Both properties must exist and belong to the caller's org.
  select * into v_source from public.properties where id = p_source_id;
  if not found or v_source.org_id <> v_org_id then
    raise exception 'Source property not found in your organization';
  end if;

  select * into v_survivor from public.properties where id = p_survivor_id;
  if not found or v_survivor.org_id <> v_org_id then
    raise exception 'Survivor property not found in your organization';
  end if;

  if v_survivor.deleted_at is not null then
    raise exception 'Survivor property is deleted';
  end if;

  -- ── Reparent simple (no-conflict) children ──
  update public.opportunities set property_id = p_survivor_id where property_id = p_source_id;
  update public.touchpoints    set property_id = p_survivor_id where property_id = p_source_id;
  update public.next_actions   set property_id = p_survivor_id where property_id = p_source_id;

  -- ── Reparent property_contacts (PK: property_id, contact_id, role_category) ──
  update public.property_contacts pc
  set property_id = p_survivor_id
  where pc.property_id = p_source_id
    and not exists (
      select 1 from public.property_contacts s
      where s.property_id = p_survivor_id
        and s.contact_id = pc.contact_id
        and s.role_category = pc.role_category
    );
  delete from public.property_contacts where property_id = p_source_id;

  -- ── Reparent property_assignments (unique: property_id, user_id) ──
  update public.property_assignments pa
  set property_id = p_survivor_id
  where pa.property_id = p_source_id
    and not exists (
      select 1 from public.property_assignments s
      where s.property_id = p_survivor_id
        and s.user_id = pa.user_id
    );
  delete from public.property_assignments where property_id = p_source_id;

  -- ── Reparent property_accounts (logical key: property_id, account_id, relationship_type) ──
  update public.property_accounts pa
  set property_id = p_survivor_id
  where pa.property_id = p_source_id
    and not exists (
      select 1 from public.property_accounts s
      where s.property_id = p_survivor_id
        and s.account_id = pa.account_id
        and s.relationship_type = pa.relationship_type
    );
  delete from public.property_accounts where property_id = p_source_id;

  -- Backfill the survivor's primary_account_id from the source if it had none.
  update public.properties p
  set primary_account_id = coalesce(p.primary_account_id, v_source.primary_account_id),
      updated_at = now()
  where p.id = p_survivor_id;

  -- ── Soft-delete the source (preserve history; respects app deleted_at filters) ──
  update public.properties
  set deleted_at = now(),
      updated_at = now()
  where id = p_source_id;

  -- ── Audit trail ──
  insert into public.merge_events (org_id, entity_type, source_entity_id, target_entity_id, merged_by, notes)
  values (v_org_id, 'property', p_source_id, p_survivor_id, v_uid, p_notes);

  select * into v_survivor from public.properties where id = p_survivor_id;
  return v_survivor;
end;
$$;

revoke all on function public.rpc_merge_property(uuid, uuid, text) from public;
grant execute on function public.rpc_merge_property(uuid, uuid, text) to authenticated;

commit;
