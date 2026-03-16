-- Migration: rpc_convert_prospect_v1
-- Converts a prospect into real CRM records (account + optional contact + property + touchpoint)

create or replace function public.rpc_convert_prospect(
  p_prospect_id       uuid,
  p_account_name      text,
  p_account_type      text        default null,
  p_account_website   text        default null,
  p_account_phone     text        default null,
  p_account_notes     text        default null,
  p_create_contact    boolean     default false,
  p_contact_full_name text        default null,
  p_contact_first_name text       default null,
  p_contact_last_name text        default null,
  p_contact_title     text        default null,
  p_contact_email     text        default null,
  p_contact_phone     text        default null,
  p_create_property   boolean     default false,
  p_property_address  text        default null,
  p_property_city     text        default null,
  p_property_state    text        default null,
  p_property_postal_code text     default null,
  p_log_touchpoint    boolean     default false,
  p_touchpoint_type_id uuid      default null,
  p_touchpoint_outcome_id uuid   default null,
  p_touchpoint_notes  text        default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_caller    uuid := auth.uid();
  v_org_id    uuid;
  v_account_id uuid;
  v_contact_id uuid;
  v_property_id uuid;
  v_touchpoint_id uuid;
  v_result    jsonb;
begin
  -- 1. Validate prospect exists and belongs to caller's org
  select p.org_id into v_org_id
    from public.prospects p
    join public.org_users ou on ou.org_id = p.org_id and ou.user_id = v_caller
   where p.id = p_prospect_id;

  if v_org_id is null then
    raise exception 'Prospect not found or access denied';
  end if;

  -- 2. Create account
  insert into public.accounts (id, org_id, name, account_type, website, phone, notes, created_by)
  values (gen_random_uuid(), v_org_id, p_account_name, p_account_type, p_account_website, p_account_phone, p_account_notes, v_caller)
  returning id into v_account_id;

  -- 3. Create contact (if requested)
  if p_create_contact then
    insert into public.contacts (id, org_id, account_id, full_name, first_name, last_name, title, email, phone, created_by)
    values (
      gen_random_uuid(), v_org_id, v_account_id,
      coalesce(nullif(trim(p_contact_full_name), ''),
               trim(coalesce(p_contact_first_name, '') || ' ' || coalesce(p_contact_last_name, '')),
               'Unknown Contact'),
      p_contact_first_name, p_contact_last_name,
      p_contact_title, p_contact_email, p_contact_phone, v_caller
    )
    returning id into v_contact_id;
  end if;

  -- 4. Create property (if requested and address fields present)
  if p_create_property and p_property_address is not null and p_property_city is not null
     and p_property_state is not null and p_property_postal_code is not null then
    insert into public.properties (id, org_id, address_line1, city, state, postal_code, primary_account_id, created_by)
    values (gen_random_uuid(), v_org_id, p_property_address, p_property_city, p_property_state, p_property_postal_code, v_account_id, v_caller)
    returning id into v_property_id;
  end if;

  -- 5. Log touchpoint (if requested and contact was created)
  if p_log_touchpoint and v_contact_id is not null and p_touchpoint_type_id is not null then
    v_result := public.rpc_log_outreach_touchpoint(
      p_contact_id        := v_contact_id,
      p_account_id        := v_account_id,
      p_touchpoint_type_id := p_touchpoint_type_id,
      p_property_id       := v_property_id,
      p_outcome_id        := p_touchpoint_outcome_id,
      p_notes             := coalesce(p_touchpoint_notes, 'Initial outreach from prospect conversion'),
      p_engagement_phase  := 'first_touch'
    );
    v_touchpoint_id := (v_result->>'touchpoint_id')::uuid;
  end if;

  -- 6. Mark prospect as converted
  update public.prospects
     set status = 'converted',
         converted_entity_id = v_account_id,
         converted_entity_type = 'account'
   where id = p_prospect_id;

  -- 7. Mark any suggested_outreach rows for this prospect + caller as converted
  update public.suggested_outreach
     set status = 'converted'
   where prospect_id = p_prospect_id
     and user_id = v_caller
     and status = 'new';

  return jsonb_build_object(
    'account_id',    v_account_id,
    'contact_id',    v_contact_id,
    'property_id',   v_property_id,
    'touchpoint_id', v_touchpoint_id
  );
end;
$$;
