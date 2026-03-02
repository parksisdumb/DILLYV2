begin;

create or replace function public.rpc_quick_add_property(
  p_account_id uuid,
  p_address_line1 text,
  p_address_line2 text default null,
  p_city text default null,
  p_state text default null,
  p_postal_code text default null,
  p_country text default 'US',
  p_notes text default null,
  p_relationship_type text default 'property_manager',
  p_is_primary boolean default true
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
  v_account_org_id uuid;
  v_relationship_type text := coalesce(
    nullif(btrim(coalesce(p_relationship_type, '')), ''),
    'property_manager'
  );
  v_property public.properties;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select m.org_id, m.role into v_org_id, v_role
  from public.rpc_get_my_org() m;

  if p_account_id is null then
    raise exception 'account_id is required';
  end if;

  if v_relationship_type not in (
    'owner', 'property_manager', 'gc', 'consultant', 'vendor', 'other'
  ) then
    raise exception 'Invalid relationship_type';
  end if;

  select a.org_id
  into v_account_org_id
  from public.accounts a
  where a.id = p_account_id;

  if v_account_org_id is null then
    raise exception 'Account not found';
  end if;

  if v_account_org_id <> v_org_id then
    raise exception 'Account must belong to your organization';
  end if;

  v_property := public.rpc_create_property(
    p_address_line1,
    p_address_line2,
    p_city,
    p_state,
    p_postal_code,
    p_country,
    p_notes
  );

  update public.properties p
  set
    primary_account_id = coalesce(p.primary_account_id, p_account_id),
    updated_at = now()
  where p.id = v_property.id
    and p.org_id = v_org_id;

  perform public.rpc_upsert_property_account(
    v_property.id,
    p_account_id,
    v_relationship_type,
    coalesce(p_is_primary, true),
    true,
    null,
    null
  );

  insert into public.property_assignments (
    org_id,
    property_id,
    user_id,
    assignment_role,
    created_by
  )
  values (
    v_org_id,
    v_property.id,
    v_uid,
    'assigned_rep',
    v_uid
  )
  on conflict (property_id, user_id) do nothing;

  select p.*
  into v_property
  from public.properties p
  where p.id = v_property.id;

  return v_property;
end;
$$;

revoke all on function public.rpc_quick_add_property(
  uuid, text, text, text, text, text, text, text, text, boolean
) from public;
grant execute on function public.rpc_quick_add_property(
  uuid, text, text, text, text, text, text, text, text, boolean
) to authenticated;

commit;
