begin;

-- =========================================================
-- rpc_core_roofing_scoring_v1
-- Core SECURITY DEFINER write API for roofing flow + scoring/streaks.
-- =========================================================

-- 0) Helper: get current org membership
create or replace function public.rpc_get_my_org()
returns table(org_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select ou.org_id, ou.role
  from public.org_users ou
  where ou.user_id = auth.uid()
  limit 1;

  if not found then
    raise exception 'User is not assigned to an organization';
  end if;
end;
$$;

revoke all on function public.rpc_get_my_org() from public;
grant execute on function public.rpc_get_my_org() to authenticated;

-- 1) Idempotent org bootstrap
create or replace function public.rpc_bootstrap_org(p_org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := nullif(btrim(p_org_name), '');
  v_org_id uuid;
  v_new_org_id uuid;
  v_admin_role_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if v_name is null then
    raise exception 'Organization name is required';
  end if;

  -- Fast path: user already has an org.
  select ou.org_id
  into v_org_id
  from public.org_users ou
  where ou.user_id = v_uid
  limit 1;

  if v_org_id is not null then
    return v_org_id;
  end if;

  -- Serialize by normalized org name.
  perform pg_advisory_xact_lock(hashtext('rpc_bootstrap_org'), hashtext(lower(v_name)));

  -- Recheck membership under lock.
  select ou.org_id
  into v_org_id
  from public.org_users ou
  where ou.user_id = v_uid
  limit 1;

  if v_org_id is not null then
    return v_org_id;
  end if;

  -- Reuse org by name if present, otherwise create.
  select o.id
  into v_org_id
  from public.orgs o
  where lower(o.name) = lower(v_name)
  order by o.created_at asc
  limit 1;

  if v_org_id is null then
    insert into public.orgs (name, created_by)
    values (v_name, v_uid)
    returning id into v_new_org_id;
    v_org_id := v_new_org_id;
  end if;

  insert into public.roles (org_id, key, name, created_by)
  values
    (v_org_id, 'admin', 'Admin', v_uid),
    (v_org_id, 'manager', 'Manager', v_uid),
    (v_org_id, 'rep', 'Rep', v_uid)
  on conflict (org_id, key) where org_id is not null do nothing;

  insert into public.org_users (org_id, user_id, role)
  values (v_org_id, v_uid, 'admin')
  on conflict (user_id) do update
    set org_id = public.org_users.org_id,
        role = 'admin'
  returning org_id into v_org_id;

  select r.id
  into v_admin_role_id
  from public.roles r
  where r.org_id = v_org_id
    and r.key = 'admin'
  limit 1;

  if to_regclass('public.memberships') is not null and v_admin_role_id is not null then
    insert into public.memberships (org_id, user_id, role_id, created_by)
    values (v_org_id, v_uid, v_admin_role_id, v_uid)
    on conflict do nothing;
  end if;

  return v_org_id;
end;
$$;

revoke all on function public.rpc_bootstrap_org(text) from public;
grant execute on function public.rpc_bootstrap_org(text) to authenticated;

-- 2) Create account
create or replace function public.rpc_create_account(
  p_name text,
  p_account_type text default null,
  p_notes text default null
)
returns public.accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role text;
  v_row public.accounts;
begin
  select m.org_id, m.role into v_org_id, v_role
  from public.rpc_get_my_org() m;

  insert into public.accounts (org_id, name, account_type, notes, created_by)
  values (v_org_id, p_name, p_account_type, p_notes, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.rpc_create_account(text, text, text) from public;
grant execute on function public.rpc_create_account(text, text, text) to authenticated;

-- 3) Create contact
create or replace function public.rpc_create_contact(
  p_account_id uuid default null,
  p_first_name text default null,
  p_last_name text default null,
  p_full_name text default null,
  p_title text default null,
  p_email text default null,
  p_phone text default null,
  p_decision_role text default null,
  p_priority_score numeric default 0
)
returns public.contacts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role text;
  v_account_org_id uuid;
  v_full_name text;
  v_row public.contacts;
begin
  select m.org_id, m.role into v_org_id, v_role
  from public.rpc_get_my_org() m;

  if p_account_id is not null then
    select a.org_id
    into v_account_org_id
    from public.accounts a
    where a.id = p_account_id;

    if v_account_org_id is null then
      raise exception 'Account not found';
    end if;

    if v_account_org_id <> v_org_id then
      raise exception 'Account is not in your organization';
    end if;
  end if;

  v_full_name := nullif(btrim(coalesce(p_full_name, '')), '');
  if v_full_name is null then
    v_full_name := nullif(btrim(concat_ws(' ', p_first_name, p_last_name)), '');
  end if;
  if v_full_name is null then
    raise exception 'full_name or first_name/last_name is required';
  end if;

  insert into public.contacts (
    org_id, account_id, full_name, first_name, last_name, title, email, phone,
    decision_role, priority_score, created_by
  )
  values (
    v_org_id, p_account_id, v_full_name, p_first_name, p_last_name, p_title, p_email, p_phone,
    p_decision_role, coalesce(p_priority_score, 0), auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.rpc_create_contact(
  uuid, text, text, text, text, text, text, text, numeric
) from public;
grant execute on function public.rpc_create_contact(
  uuid, text, text, text, text, text, text, text, numeric
) to authenticated;

-- 4) Create property
create or replace function public.rpc_create_property(
  p_address_line1 text,
  p_address_line2 text default null,
  p_city text default null,
  p_state text default null,
  p_postal_code text default null,
  p_country text default 'US',
  p_notes text default null,
  p_roof_metadata jsonb default '{}'::jsonb
)
returns public.properties
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role text;
  v_has_roof_metadata boolean;
  v_has_metadata boolean;
  v_row public.properties;
begin
  select m.org_id, m.role into v_org_id, v_role
  from public.rpc_get_my_org() m;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'properties'
      and c.column_name = 'roof_metadata'
  ) into v_has_roof_metadata;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'properties'
      and c.column_name = 'metadata'
  ) into v_has_metadata;

  if v_has_roof_metadata then
    execute $sql$
      insert into public.properties (
        org_id, address_line1, address_line2, city, state, postal_code, country, notes, roof_metadata, created_by
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      returning *
    $sql$
    into v_row
    using v_org_id, p_address_line1, p_address_line2, p_city, p_state, p_postal_code, coalesce(nullif(p_country,''), 'US'), p_notes, coalesce(p_roof_metadata, '{}'::jsonb), auth.uid();
  elsif v_has_metadata then
    execute $sql$
      insert into public.properties (
        org_id, address_line1, address_line2, city, state, postal_code, country, notes, metadata, created_by
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      returning *
    $sql$
    into v_row
    using v_org_id, p_address_line1, p_address_line2, p_city, p_state, p_postal_code, coalesce(nullif(p_country,''), 'US'), p_notes, coalesce(p_roof_metadata, '{}'::jsonb), auth.uid();
  else
    insert into public.properties (
      org_id, address_line1, address_line2, city, state, postal_code, country, notes, created_by
    )
    values (
      v_org_id, p_address_line1, p_address_line2, p_city, p_state, p_postal_code, coalesce(nullif(p_country,''), 'US'), p_notes, auth.uid()
    )
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke all on function public.rpc_create_property(
  text, text, text, text, text, text, text, jsonb
) from public;
grant execute on function public.rpc_create_property(
  text, text, text, text, text, text, text, jsonb
) to authenticated;

-- 5) Upsert property-account relationship
create or replace function public.rpc_upsert_property_account(
  p_property_id uuid,
  p_account_id uuid,
  p_relationship_type text,
  p_is_primary boolean default false,
  p_active boolean default true,
  p_starts_on date default null,
  p_ends_on date default null
)
returns public.property_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role text;
  v_property_org_id uuid;
  v_account_org_id uuid;
  v_row public.property_accounts;
  v_has_conflict_key boolean;
begin
  select m.org_id, m.role into v_org_id, v_role
  from public.rpc_get_my_org() m;

  select p.org_id
  into v_property_org_id
  from public.properties p
  where p.id = p_property_id;

  if v_property_org_id is null then
    raise exception 'Property not found';
  end if;

  select a.org_id
  into v_account_org_id
  from public.accounts a
  where a.id = p_account_id;

  if v_account_org_id is null then
    raise exception 'Account not found';
  end if;

  if v_property_org_id <> v_org_id or v_account_org_id <> v_org_id then
    raise exception 'Property/account must belong to your organization';
  end if;

  if coalesce(p_is_primary, false) and coalesce(p_active, true) then
    update public.property_accounts pa
    set is_primary = false
    where pa.org_id = v_org_id
      and pa.property_id = p_property_id
      and pa.relationship_type = p_relationship_type
      and pa.active = true
      and not (pa.account_id = p_account_id and pa.starts_on is not distinct from p_starts_on);
  end if;

  if p_starts_on is null then
    select to_regclass('public.property_accounts_unique_without_starts_on') is not null
    into v_has_conflict_key;

    if v_has_conflict_key then
      insert into public.property_accounts (
        org_id, property_id, account_id, relationship_type, is_primary, active, starts_on, ends_on, created_by
      )
      values (
        v_org_id, p_property_id, p_account_id, p_relationship_type, coalesce(p_is_primary, false), coalesce(p_active, true), p_starts_on, p_ends_on, auth.uid()
      )
      on conflict (property_id, account_id, relationship_type) where starts_on is null
      do update set
        org_id = excluded.org_id,
        is_primary = excluded.is_primary,
        active = excluded.active,
        ends_on = excluded.ends_on
      returning * into v_row;
    else
      insert into public.property_accounts (
        org_id, property_id, account_id, relationship_type, is_primary, active, starts_on, ends_on, created_by
      )
      values (
        v_org_id, p_property_id, p_account_id, p_relationship_type, coalesce(p_is_primary, false), coalesce(p_active, true), p_starts_on, p_ends_on, auth.uid()
      )
      returning * into v_row;
    end if;
  else
    select to_regclass('public.property_accounts_unique_with_starts_on') is not null
    into v_has_conflict_key;

    if v_has_conflict_key then
      insert into public.property_accounts (
        org_id, property_id, account_id, relationship_type, is_primary, active, starts_on, ends_on, created_by
      )
      values (
        v_org_id, p_property_id, p_account_id, p_relationship_type, coalesce(p_is_primary, false), coalesce(p_active, true), p_starts_on, p_ends_on, auth.uid()
      )
      on conflict (property_id, account_id, relationship_type, starts_on) where starts_on is not null
      do update set
        org_id = excluded.org_id,
        is_primary = excluded.is_primary,
        active = excluded.active,
        ends_on = excluded.ends_on
      returning * into v_row;
    else
      insert into public.property_accounts (
        org_id, property_id, account_id, relationship_type, is_primary, active, starts_on, ends_on, created_by
      )
      values (
        v_org_id, p_property_id, p_account_id, p_relationship_type, coalesce(p_is_primary, false), coalesce(p_active, true), p_starts_on, p_ends_on, auth.uid()
      )
      returning * into v_row;
    end if;
  end if;

  return v_row;
end;
$$;

revoke all on function public.rpc_upsert_property_account(
  uuid, uuid, text, boolean, boolean, date, date
) from public;
grant execute on function public.rpc_upsert_property_account(
  uuid, uuid, text, boolean, boolean, date, date
) to authenticated;

-- 6) Upsert property-contact relationship
create or replace function public.rpc_upsert_property_contact(
  p_property_id uuid,
  p_contact_id uuid,
  p_role_category text,
  p_role_label text default null,
  p_priority_rank int default 0,
  p_is_primary boolean default false,
  p_active boolean default true
)
returns public.property_contacts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role text;
  v_property_org_id uuid;
  v_contact_org_id uuid;
  v_row public.property_contacts;
  v_has_conflict_key boolean;
begin
  select m.org_id, m.role into v_org_id, v_role
  from public.rpc_get_my_org() m;

  select p.org_id
  into v_property_org_id
  from public.properties p
  where p.id = p_property_id;

  if v_property_org_id is null then
    raise exception 'Property not found';
  end if;

  select c.org_id
  into v_contact_org_id
  from public.contacts c
  where c.id = p_contact_id;

  if v_contact_org_id is null then
    raise exception 'Contact not found';
  end if;

  if v_property_org_id <> v_org_id or v_contact_org_id <> v_org_id then
    raise exception 'Property/contact must belong to your organization';
  end if;

  if coalesce(p_is_primary, false) and coalesce(p_active, true) then
    update public.property_contacts pc
    set is_primary = false,
        updated_at = now()
    where pc.org_id = v_org_id
      and pc.property_id = p_property_id
      and pc.role_category = coalesce(p_role_category, 'other')
      and pc.active = true
      and pc.contact_id <> p_contact_id;
  end if;

  select exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'property_contacts'
      and tc.constraint_type in ('PRIMARY KEY', 'UNIQUE')
      and tc.constraint_name = 'property_contacts_pkey'
  ) into v_has_conflict_key;

  if v_has_conflict_key then
    insert into public.property_contacts (
      org_id, property_id, contact_id, role_category, role_label, priority_rank, is_primary, active, created_by
    )
    values (
      v_org_id, p_property_id, p_contact_id, coalesce(p_role_category, 'other'), p_role_label, coalesce(p_priority_rank, 0), coalesce(p_is_primary, false), coalesce(p_active, true), auth.uid()
    )
    on conflict (property_id, contact_id, role_category)
    do update set
      org_id = excluded.org_id,
      role_label = excluded.role_label,
      priority_rank = excluded.priority_rank,
      is_primary = excluded.is_primary,
      active = excluded.active,
      updated_at = now()
    returning * into v_row;
  else
    insert into public.property_contacts (
      org_id, property_id, contact_id, role_category, role_label, priority_rank, is_primary, active, created_by
    )
    values (
      v_org_id, p_property_id, p_contact_id, coalesce(p_role_category, 'other'), p_role_label, coalesce(p_priority_rank, 0), coalesce(p_is_primary, false), coalesce(p_active, true), auth.uid()
    )
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke all on function public.rpc_upsert_property_contact(
  uuid, uuid, text, text, int, boolean, boolean
) from public;
grant execute on function public.rpc_upsert_property_contact(
  uuid, uuid, text, text, int, boolean, boolean
) to authenticated;

-- 7) Create next action
create or replace function public.rpc_create_next_action(
  p_property_id uuid,
  p_opportunity_id uuid default null,
  p_assigned_user_id uuid default null,
  p_due_at timestamptz default null,
  p_notes text default null,
  p_recommended_touchpoint_type_id uuid default null
)
returns public.next_actions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role text;
  v_property_org_id uuid;
  v_opp_org_id uuid;
  v_assigned_user_id uuid := coalesce(p_assigned_user_id, auth.uid());
  v_assigned_user_org_id uuid;
  v_type_org_id uuid;
  v_row public.next_actions;
begin
  select m.org_id, m.role into v_org_id, v_role
  from public.rpc_get_my_org() m;

  select p.org_id
  into v_property_org_id
  from public.properties p
  where p.id = p_property_id;

  if v_property_org_id is null then
    raise exception 'Property not found';
  end if;
  if v_property_org_id <> v_org_id then
    raise exception 'Property is not in your organization';
  end if;

  if p_opportunity_id is not null then
    select o.org_id
    into v_opp_org_id
    from public.opportunities o
    where o.id = p_opportunity_id;

    if v_opp_org_id is null then
      raise exception 'Opportunity not found';
    end if;
    if v_opp_org_id <> v_org_id then
      raise exception 'Opportunity is not in your organization';
    end if;
  end if;

  select ou.org_id
  into v_assigned_user_org_id
  from public.org_users ou
  where ou.user_id = v_assigned_user_id
  limit 1;

  if v_assigned_user_org_id is null or v_assigned_user_org_id <> v_org_id then
    raise exception 'Assigned user is not in your organization';
  end if;

  if p_recommended_touchpoint_type_id is not null then
    select tt.org_id
    into v_type_org_id
    from public.touchpoint_types tt
    where tt.id = p_recommended_touchpoint_type_id;

    if v_type_org_id is null and not exists (
      select 1 from public.touchpoint_types tt where tt.id = p_recommended_touchpoint_type_id and tt.org_id is null
    ) then
      raise exception 'Recommended touchpoint type not found';
    end if;

    if v_type_org_id is not null and v_type_org_id <> v_org_id then
      raise exception 'Recommended touchpoint type is not in your organization';
    end if;
  end if;

  if p_due_at is null then
    raise exception 'due_at is required';
  end if;

  insert into public.next_actions (
    org_id, property_id, opportunity_id, assigned_user_id, due_at, notes,
    recommended_touchpoint_type_id, status, created_by
  )
  values (
    v_org_id, p_property_id, p_opportunity_id, v_assigned_user_id, p_due_at, p_notes,
    p_recommended_touchpoint_type_id, 'open', auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.rpc_create_next_action(
  uuid, uuid, uuid, timestamptz, text, uuid
) from public;
grant execute on function public.rpc_create_next_action(
  uuid, uuid, uuid, timestamptz, text, uuid
) to authenticated;

-- 8) Log touchpoint + side effects
create or replace function public.rpc_log_touchpoint(
  p_property_id uuid,
  p_account_id uuid default null,
  p_contact_id uuid default null,
  p_opportunity_id uuid default null,
  p_touchpoint_type_id uuid default null,
  p_outcome_id uuid default null,
  p_happened_at timestamptz default now(),
  p_notes text default null,
  p_rep_user_id uuid default auth.uid(),
  p_complete_next_action_id uuid default null
)
returns table(
  touchpoint_id uuid,
  awarded_points int,
  new_streak_values jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role text;
  v_property_org_id uuid;
  v_account_org_id uuid;
  v_contact_org_id uuid;
  v_opp_org_id uuid;
  v_type_org_id uuid;
  v_outcome_org_id uuid;
  v_touchpoint_id uuid;
  v_completed_next_action_id uuid;
  v_has_score_rule boolean := false;
  v_points int := 0;
  v_event_date date := (coalesce(p_happened_at, now()) at time zone 'utc')::date;
  v_touch_streak_count int;
  v_touch_streak_date date;
  v_next_streak_count int;
  v_next_streak_date date;
  v_streak_json jsonb;
begin
  select m.org_id, m.role into v_org_id, v_role
  from public.rpc_get_my_org() m;

  if p_rep_user_id is null then
    raise exception 'rep_user_id is required';
  end if;

  if p_touchpoint_type_id is null then
    raise exception 'touchpoint_type_id is required';
  end if;

  if not exists (
    select 1 from public.org_users ou
    where ou.org_id = v_org_id
      and ou.user_id = p_rep_user_id
  ) then
    raise exception 'rep_user_id is not in your organization';
  end if;

  select p.org_id into v_property_org_id
  from public.properties p
  where p.id = p_property_id;
  if v_property_org_id is null or v_property_org_id <> v_org_id then
    raise exception 'Property must belong to your organization';
  end if;

  if p_account_id is not null then
    select a.org_id into v_account_org_id
    from public.accounts a
    where a.id = p_account_id;
    if v_account_org_id is null or v_account_org_id <> v_org_id then
      raise exception 'Account must belong to your organization';
    end if;
  end if;

  if p_contact_id is not null then
    select c.org_id into v_contact_org_id
    from public.contacts c
    where c.id = p_contact_id;
    if v_contact_org_id is null or v_contact_org_id <> v_org_id then
      raise exception 'Contact must belong to your organization';
    end if;
  end if;

  if p_opportunity_id is not null then
    select o.org_id into v_opp_org_id
    from public.opportunities o
    where o.id = p_opportunity_id;
    if v_opp_org_id is null or v_opp_org_id <> v_org_id then
      raise exception 'Opportunity must belong to your organization';
    end if;
  end if;

  select tt.org_id into v_type_org_id
  from public.touchpoint_types tt
  where tt.id = p_touchpoint_type_id;
  if v_type_org_id is null and not exists (
    select 1 from public.touchpoint_types tt
    where tt.id = p_touchpoint_type_id and tt.org_id is null
  ) then
    raise exception 'Touchpoint type not found';
  end if;
  if v_type_org_id is not null and v_type_org_id <> v_org_id then
    raise exception 'Touchpoint type is not in your organization';
  end if;

  if p_outcome_id is not null then
    select o.org_id into v_outcome_org_id
    from public.touchpoint_outcomes o
    where o.id = p_outcome_id;
    if v_outcome_org_id is null and not exists (
      select 1 from public.touchpoint_outcomes o
      where o.id = p_outcome_id and o.org_id is null
    ) then
      raise exception 'Outcome not found';
    end if;
    if v_outcome_org_id is not null and v_outcome_org_id <> v_org_id then
      raise exception 'Outcome is not in your organization';
    end if;
  end if;

  -- A) Insert touchpoint
  insert into public.touchpoints (
    org_id, rep_user_id, property_id, account_id, contact_id, opportunity_id,
    touchpoint_type_id, outcome_id, happened_at, notes, created_by
  )
  values (
    v_org_id, p_rep_user_id, p_property_id, p_account_id, p_contact_id, p_opportunity_id,
    p_touchpoint_type_id, p_outcome_id, coalesce(p_happened_at, now()), p_notes, auth.uid()
  )
  returning id into v_touchpoint_id;

  -- B) Complete next action if provided
  if p_complete_next_action_id is not null then
    update public.next_actions na
    set
      status = 'completed',
      completed_by_touchpoint_id = v_touchpoint_id,
      updated_at = now()
    where na.id = p_complete_next_action_id
      and na.org_id = v_org_id
      and na.assigned_user_id = p_rep_user_id
      and na.status = 'open'
    returning na.id into v_completed_next_action_id;

    if v_completed_next_action_id is null then
      raise exception 'Next action not found/open/assigned to rep';
    end if;
  end if;

  -- C) Award points from score rules
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
      p_rep_user_id,
      v_touchpoint_id,
      coalesce(v_points, 0),
      case
        when p_outcome_id is not null then 'touchpoint+outcome'
        else 'touchpoint'
      end,
      auth.uid()
    );
  else
    v_points := 0;
  end if;

  -- D1) daily_touchpoints streak
  insert into public.streaks (
    org_id, user_id, streak_type, current_count, last_earned_date, updated_at
  )
  values (
    v_org_id, p_rep_user_id, 'daily_touchpoints', 1, v_event_date, now()
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
    updated_at = now()
  returning current_count, last_earned_date
  into v_touch_streak_count, v_touch_streak_date;

  -- D2) daily_next_actions streak
  if v_completed_next_action_id is not null then
    insert into public.streaks (
      org_id, user_id, streak_type, current_count, last_earned_date, updated_at
    )
    values (
      v_org_id, p_rep_user_id, 'daily_next_actions', 1, v_event_date, now()
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
      updated_at = now()
    returning current_count, last_earned_date
    into v_next_streak_count, v_next_streak_date;
  end if;

  v_streak_json := jsonb_build_object(
    'daily_touchpoints',
    jsonb_build_object(
      'current_count', v_touch_streak_count,
      'last_earned_date', v_touch_streak_date
    ),
    'daily_next_actions',
    case
      when v_completed_next_action_id is not null then
        jsonb_build_object(
          'current_count', v_next_streak_count,
          'last_earned_date', v_next_streak_date
        )
      else null
    end
  );

  return query
  select v_touchpoint_id, coalesce(v_points, 0), v_streak_json;
end;
$$;

revoke all on function public.rpc_log_touchpoint(
  uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text, uuid, uuid
) from public;
grant execute on function public.rpc_log_touchpoint(
  uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text, uuid, uuid
) to authenticated;

commit;
