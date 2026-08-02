-- rpc_merge_contact_v1
--
-- Manager/admin tool to merge a duplicate contact (source) into a surviving
-- contact, mirroring rpc_merge_property. Contact data arrives from manual entry,
-- CSV import, intel feeds and prospect conversion with only soft (advisory) dedup,
-- so the same person shows up twice ("Eileen Chun"/"Eileen Cun", "Robyn Keller"
-- x2, "sarah"/"Sarah Sandoval"). This atomically re-points every child row from
-- the source to the survivor, backfills the survivor's blank email/phone/title
-- from the source, soft-deletes the source, and records the merge.
--
-- Reparented by contact_id: touchpoints, next_actions, and property_contacts
-- (PK property_id+contact_id+role_category → ON CONFLICT-skip: a link that would
-- collide with an existing survivor link is dropped, not duplicated). Re-pointed
-- where they named the source: opportunities.primary_contact_id,
-- accounts.primary_contact_id, properties.primary_contact_id,
-- synced_emails.matched_contact_id.
--
-- SECURITY DEFINER: intentionally bypasses the touchpoints insert-only RLS so the
-- immutable ledger can be re-parented during an administrative merge. This is the
-- sanctioned path — reps cannot update touchpoints directly.
--
-- NOTE: like all migrations in this repo, must be applied to prod manually (prod
-- `db push` is blocked). Until applied, the app's merge button degrades gracefully
-- with a "function not found" error.

begin;

create or replace function public.rpc_merge_contact(
  p_source_id uuid,
  p_survivor_id uuid,
  p_notes text default null
)
returns public.contacts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_role text;
  v_source public.contacts;
  v_survivor public.contacts;
  v_email text;
  v_phone text;
  v_title text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_source_id is null or p_survivor_id is null then
    raise exception 'Both source and survivor contact ids are required';
  end if;

  if p_source_id = p_survivor_id then
    raise exception 'Cannot merge a contact into itself';
  end if;

  select m.org_id, m.role into v_org_id, v_role
  from public.rpc_get_my_org() m;

  if v_role not in ('manager', 'admin') then
    raise exception 'Only managers or admins can merge contacts';
  end if;

  -- Both contacts must exist and belong to the caller's org.
  select * into v_source from public.contacts where id = p_source_id;
  if not found or v_source.org_id <> v_org_id then
    raise exception 'Source contact not found in your organization';
  end if;

  select * into v_survivor from public.contacts where id = p_survivor_id;
  if not found or v_survivor.org_id <> v_org_id then
    raise exception 'Survivor contact not found in your organization';
  end if;

  if v_survivor.deleted_at is not null then
    raise exception 'Survivor contact is deleted';
  end if;

  -- ── Reparent simple (no-conflict) children by contact_id ──
  update public.touchpoints  set contact_id = p_survivor_id where contact_id = p_source_id;
  update public.next_actions set contact_id = p_survivor_id where contact_id = p_source_id;

  -- ── Re-point single-contact references that named the source ──
  update public.opportunities set primary_contact_id = p_survivor_id where primary_contact_id = p_source_id;
  update public.accounts       set primary_contact_id = p_survivor_id where primary_contact_id = p_source_id;
  update public.properties     set primary_contact_id = p_survivor_id where primary_contact_id = p_source_id;
  update public.synced_emails  set matched_contact_id = p_survivor_id where matched_contact_id = p_source_id;

  -- ── Reparent property_contacts (PK: property_id, contact_id, role_category) ──
  update public.property_contacts pc
  set contact_id = p_survivor_id
  where pc.contact_id = p_source_id
    and not exists (
      select 1 from public.property_contacts s
      where s.property_id = pc.property_id
        and s.contact_id = p_survivor_id
        and s.role_category = pc.role_category
    );
  delete from public.property_contacts where contact_id = p_source_id;

  -- ── Backfill the survivor's blank email/phone/title from the source, and keep
  --    the normalized dedup columns in sync (no update trigger maintains them). ──
  v_email := coalesce(nullif(btrim(v_survivor.email), ''), nullif(btrim(v_source.email), ''));
  v_phone := coalesce(nullif(btrim(v_survivor.phone), ''), nullif(btrim(v_source.phone), ''));
  v_title := coalesce(nullif(btrim(v_survivor.title), ''), nullif(btrim(v_source.title), ''));

  update public.contacts
  set email = v_email,
      phone = v_phone,
      title = v_title,
      email_normalized = lower(btrim(v_email)),
      phone_normalized = nullif(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), ''),
      updated_at = now()
  where id = p_survivor_id;

  -- ── Soft-delete the source (preserve history; respects app deleted_at filters) ──
  update public.contacts
  set deleted_at = now(),
      is_active = false,
      updated_at = now()
  where id = p_source_id;

  -- ── Audit trail ──
  insert into public.merge_events (org_id, entity_type, source_entity_id, target_entity_id, merged_by, notes)
  values (v_org_id, 'contact', p_source_id, p_survivor_id, v_uid, p_notes);

  select * into v_survivor from public.contacts where id = p_survivor_id;
  return v_survivor;
end;
$$;

revoke all on function public.rpc_merge_contact(uuid, uuid, text) from public;
grant execute on function public.rpc_merge_contact(uuid, uuid, text) to authenticated;

commit;
