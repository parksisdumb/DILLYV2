begin;

drop function if exists public.rpc_log_outreach_touchpoint(
  uuid, uuid, uuid, timestamptz, text, uuid, text, text, text, text, text, text, numeric, uuid, text, text
);

create function public.rpc_log_outreach_touchpoint(
  p_property_id uuid default null,
  p_property_address_line1 text default null,
  p_property_address_line2 text default null,
  p_property_city text default null,
  p_property_state text default null,
  p_property_postal_code text default null,
  p_property_country text default 'US',
  p_property_notes text default null,
  p_property_account_relationship_type text default 'property_manager',
  p_property_account_is_primary boolean default true,
  p_touchpoint_type_id uuid default null,
  p_outcome_id uuid default null,
  p_happened_at timestamptz default now(),
  p_notes text default null,
  p_contact_id uuid default null,
  p_contact_first_name text default null,
  p_contact_last_name text default null,
  p_contact_title text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_decision_role text default null,
  p_priority_score numeric default 0,
  p_account_id uuid default null,
  p_account_name text default null,
  p_account_type text default null
)
returns table(
  touchpoint jsonb,
  created_contact_id uuid,
  created_account_id uuid,
  created_property_id uuid,
  awarded_points int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_role text;
  v_type_org_id uuid;
  v_type_is_outreach boolean := false;
  v_outcome_org_id uuid;
  v_existing_contact_org_id uuid;
  v_existing_contact_account_id uuid;
  v_resolved_contact_id uuid;
  v_resolved_account_id uuid;
  v_resolved_property_id uuid;
  v_property_org_id uuid;
  v_created_contact_id uuid;
  v_created_account_id uuid;
  v_created_property_id uuid;
  v_touchpoint public.touchpoints;
  v_has_score_rule boolean := false;
  v_points int := 0;
  v_event_date date := (coalesce(p_happened_at, now()) at time zone 'utc')::date;
  v_relationship_type text := coalesce(
    nullif(btrim(coalesce(p_property_account_relationship_type, '')), ''),
    'property_manager'
  );
  v_relationship_is_primary boolean := coalesce(p_property_account_is_primary, true);
  v_property_account_link_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select m.org_id, m.role into v_org_id, v_role
  from public.rpc_get_my_org() m;

  if p_touchpoint_type_id is null then
    raise exception 'touchpoint_type_id is required';
  end if;

  if nullif(btrim(coalesce(p_notes, '')), '') is null then
    raise exception 'notes is required';
  end if;

  if v_relationship_type not in (
    'owner', 'property_manager', 'gc', 'consultant', 'vendor', 'other'
  ) then
    raise exception 'Invalid property_account relationship_type';
  end if;

  select tt.org_id, coalesce(tt.is_outreach, false)
  into v_type_org_id, v_type_is_outreach
  from public.touchpoint_types tt
  where tt.id = p_touchpoint_type_id;

  if not found then
    raise exception 'Touchpoint type not found';
  end if;

  if v_type_org_id is not null and v_type_org_id <> v_org_id then
    raise exception 'Touchpoint type is not in your organization';
  end if;

  if not v_type_is_outreach then
    raise exception 'touchpoint_type_id must be an outreach touchpoint type';
  end if;

  if p_outcome_id is not null then
    select o.org_id into v_outcome_org_id
    from public.touchpoint_outcomes o
    where o.id = p_outcome_id;

    if v_outcome_org_id is null and not exists (
      select 1
      from public.touchpoint_outcomes o
      where o.id = p_outcome_id
        and o.org_id is null
    ) then
      raise exception 'Outcome not found';
    end if;

    if v_outcome_org_id is not null and v_outcome_org_id <> v_org_id then
      raise exception 'Outcome is not in your organization';
    end if;
  end if;

  if p_contact_id is not null then
    if nullif(btrim(coalesce(p_contact_first_name, '')), '') is not null
       or nullif(btrim(coalesce(p_contact_last_name, '')), '') is not null then
      raise exception 'Provide either p_contact_id or new contact name fields, not both';
    end if;

    if nullif(btrim(coalesce(p_account_name, '')), '') is not null then
      raise exception 'p_account_name is only allowed when creating a contact';
    end if;

    select c.org_id, c.account_id
    into v_existing_contact_org_id, v_existing_contact_account_id
    from public.contacts c
    where c.id = p_contact_id;

    if v_existing_contact_org_id is null then
      raise exception 'Contact not found';
    end if;

    if v_existing_contact_org_id <> v_org_id then
      raise exception 'Contact must belong to your organization';
    end if;

    if v_existing_contact_account_id is null then
      raise exception 'Contact must have account_id';
    end if;

    v_resolved_contact_id := p_contact_id;
    v_resolved_account_id := v_existing_contact_account_id;

    if p_account_id is not null and p_account_id <> v_resolved_account_id then
      raise exception 'p_account_id does not match the selected contact account';
    end if;
  else
    if nullif(btrim(coalesce(p_contact_first_name, '')), '') is null
       or nullif(btrim(coalesce(p_contact_last_name, '')), '') is null then
      raise exception 'Contact is required (provide p_contact_id or first/last name)';
    end if;

    if p_account_id is not null and nullif(btrim(coalesce(p_account_name, '')), '') is not null then
      raise exception 'Provide either p_account_id or p_account_name, not both';
    end if;

    if p_account_id is null and nullif(btrim(coalesce(p_account_name, '')), '') is null then
      raise exception 'Account is required when creating a contact';
    end if;

    if p_account_id is not null then
      select a.id into v_resolved_account_id
      from public.accounts a
      where a.id = p_account_id
        and a.org_id = v_org_id;

      if v_resolved_account_id is null then
        raise exception 'Account must belong to your organization';
      end if;
    else
      insert into public.accounts (
        org_id, name, account_type, created_by
      )
      values (
        v_org_id, btrim(p_account_name), p_account_type, v_uid
      )
      returning id into v_resolved_account_id;

      v_created_account_id := v_resolved_account_id;
    end if;

    insert into public.contacts (
      org_id, account_id, full_name, first_name, last_name, title, email, phone,
      decision_role, priority_score, created_by
    )
    values (
      v_org_id,
      v_resolved_account_id,
      btrim(concat_ws(' ', p_contact_first_name, p_contact_last_name)),
      btrim(p_contact_first_name),
      btrim(p_contact_last_name),
      nullif(btrim(coalesce(p_contact_title, '')), ''),
      nullif(btrim(coalesce(p_contact_email, '')), ''),
      nullif(btrim(coalesce(p_contact_phone, '')), ''),
      nullif(btrim(coalesce(p_decision_role, '')), ''),
      coalesce(p_priority_score, 0),
      v_uid
    )
    returning id into v_resolved_contact_id;

    v_created_contact_id := v_resolved_contact_id;
  end if;

  if v_resolved_contact_id is null then
    raise exception 'Contact is required';
  end if;

  if v_resolved_account_id is null then
    raise exception 'Account resolution failed for outreach touchpoint';
  end if;

  if p_property_id is not null then
    select p.org_id into v_property_org_id
    from public.properties p
    where p.id = p_property_id;

    if v_property_org_id is null or v_property_org_id <> v_org_id then
      raise exception 'Property must belong to your organization';
    end if;

    v_resolved_property_id := p_property_id;
  else
    if nullif(btrim(coalesce(p_property_address_line1, '')), '') is null
       or nullif(btrim(coalesce(p_property_city, '')), '') is null
       or nullif(btrim(coalesce(p_property_state, '')), '') is null
       or nullif(btrim(coalesce(p_property_postal_code, '')), '') is null then
      raise exception 'Property is required (provide p_property_id or full property address)';
    end if;

    insert into public.properties (
      org_id,
      address_line1,
      address_line2,
      city,
      state,
      postal_code,
      country,
      notes,
      primary_account_id,
      primary_contact_id,
      created_by
    )
    values (
      v_org_id,
      btrim(p_property_address_line1),
      nullif(btrim(coalesce(p_property_address_line2, '')), ''),
      btrim(p_property_city),
      btrim(p_property_state),
      btrim(p_property_postal_code),
      coalesce(nullif(btrim(coalesce(p_property_country, '')), ''), 'US'),
      nullif(btrim(coalesce(p_property_notes, '')), ''),
      v_resolved_account_id,
      v_resolved_contact_id,
      v_uid
    )
    returning id into v_resolved_property_id;

    v_created_property_id := v_resolved_property_id;
  end if;

  update public.property_accounts pa
  set
    active = true,
    is_primary = v_relationship_is_primary
  where pa.org_id = v_org_id
    and pa.property_id = v_resolved_property_id
    and pa.account_id = v_resolved_account_id
    and pa.relationship_type = v_relationship_type
    and pa.starts_on is null
  returning pa.id into v_property_account_link_id;

  if v_property_account_link_id is null then
    insert into public.property_accounts (
      org_id,
      property_id,
      account_id,
      relationship_type,
      is_primary,
      active,
      created_by
    )
    values (
      v_org_id,
      v_resolved_property_id,
      v_resolved_account_id,
      v_relationship_type,
      v_relationship_is_primary,
      true,
      v_uid
    )
    returning id into v_property_account_link_id;
  end if;

  if v_relationship_is_primary then
    update public.property_accounts pa
    set is_primary = false
    where pa.org_id = v_org_id
      and pa.property_id = v_resolved_property_id
      and pa.relationship_type = v_relationship_type
      and pa.active = true
      and pa.id <> v_property_account_link_id;
  end if;

  insert into public.touchpoints (
    org_id,
    rep_user_id,
    property_id,
    account_id,
    contact_id,
    touchpoint_type_id,
    outcome_id,
    happened_at,
    notes,
    created_by
  )
  values (
    v_org_id,
    v_uid,
    v_resolved_property_id,
    v_resolved_account_id,
    v_resolved_contact_id,
    p_touchpoint_type_id,
    p_outcome_id,
    coalesce(p_happened_at, now()),
    p_notes,
    v_uid
  )
  returning * into v_touchpoint;

  if p_outcome_id is not null then
    select sr.points
    into v_points
    from public.score_rules sr
    where (sr.org_id = v_org_id or sr.org_id is null)
      and sr.touchpoint_type_id = p_touchpoint_type_id
      and sr.outcome_id = p_outcome_id
    order by (sr.org_id is null), sr.created_at desc
    limit 1;

    if found then
      v_has_score_rule := true;
    end if;
  end if;

  if not v_has_score_rule then
    select sr.points
    into v_points
    from public.score_rules sr
    where (sr.org_id = v_org_id or sr.org_id is null)
      and sr.touchpoint_type_id = p_touchpoint_type_id
      and sr.outcome_id is null
    order by (sr.org_id is null), sr.created_at desc
    limit 1;

    if found then
      v_has_score_rule := true;
    end if;
  end if;

  if v_has_score_rule then
    insert into public.score_events (
      org_id, user_id, touchpoint_id, points, reason, created_by
    )
    values (
      v_org_id,
      v_uid,
      v_touchpoint.id,
      coalesce(v_points, 0),
      case
        when p_outcome_id is not null then 'outreach_touchpoint+outcome'
        else 'outreach_touchpoint'
      end,
      v_uid
    );
  else
    v_points := 0;
  end if;

  insert into public.streaks (
    org_id, user_id, streak_type, current_count, last_earned_date, updated_at
  )
  values (
    v_org_id, v_uid, 'daily_outreach', 1, v_event_date, now()
  )
  on conflict (org_id, user_id, streak_type)
  do update set
    current_count = case
      when public.streaks.last_earned_date = excluded.last_earned_date then public.streaks.current_count
      else public.streaks.current_count + 1
    end,
    last_earned_date = case
      when public.streaks.last_earned_date is null then excluded.last_earned_date
      else greatest(public.streaks.last_earned_date, excluded.last_earned_date)
    end,
    updated_at = now();

  return query
  select
    to_jsonb(v_touchpoint),
    v_created_contact_id,
    v_created_account_id,
    v_created_property_id,
    coalesce(v_points, 0);
end;
$$;

revoke all on function public.rpc_log_outreach_touchpoint(
  uuid, text, text, text, text, text, text, text, text, boolean, uuid, uuid, timestamptz, text, uuid, text, text, text, text, text, text, numeric, uuid, text, text
) from public;
grant execute on function public.rpc_log_outreach_touchpoint(
  uuid, text, text, text, text, text, text, text, text, boolean, uuid, uuid, timestamptz, text, uuid, text, text, text, text, text, text, numeric, uuid, text, text
) to authenticated;

commit;
