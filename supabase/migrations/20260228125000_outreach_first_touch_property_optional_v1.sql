begin;

alter table public.touchpoints
  alter column property_id drop not null;

drop function if exists public.rpc_log_outreach_touchpoint(
  uuid, uuid, uuid, uuid, uuid, text, timestamptz
);
drop function if exists public.rpc_log_outreach_touchpoint(
  uuid, uuid, uuid, uuid, uuid, text, timestamptz, text
);

create function public.rpc_log_outreach_touchpoint(
  p_contact_id uuid,
  p_account_id uuid,
  p_touchpoint_type_id uuid,
  p_property_id uuid default null,
  p_outcome_id uuid default null,
  p_notes text default null,
  p_happened_at timestamptz default now(),
  p_engagement_phase text default 'first_touch'
)
returns table(
  touchpoint_id uuid,
  awarded_points int,
  outreach_count_today int,
  outreach_target numeric,
  outreach_remaining numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_role text;
  v_contact_org_id uuid;
  v_contact_account_id uuid;
  v_account_org_id uuid;
  v_property_org_id uuid;
  v_type_org_id uuid;
  v_type_is_outreach boolean := false;
  v_outcome_org_id uuid;
  v_touchpoint_id uuid;
  v_has_score_rule boolean := false;
  v_points int := 0;
  v_event_date date := (coalesce(p_happened_at, now()) at time zone 'utc')::date;
  v_outreach_count int := 0;
  v_target numeric := 20;
  v_engagement_phase text := coalesce(nullif(btrim(coalesce(p_engagement_phase, '')), ''), 'first_touch');
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select m.org_id, m.role into v_org_id, v_role
  from public.rpc_get_my_org() m;

  if p_contact_id is null then
    raise exception 'contact_id is required';
  end if;
  if p_account_id is null then
    raise exception 'account_id is required';
  end if;
  if p_touchpoint_type_id is null then
    raise exception 'touchpoint_type_id is required';
  end if;
  if nullif(btrim(coalesce(p_notes, '')), '') is null then
    raise exception 'notes is required';
  end if;

  if v_engagement_phase not in ('first_touch', 'follow_up', 'other') then
    raise exception 'engagement_phase must be first_touch, follow_up, or other';
  end if;

  select c.org_id, c.account_id
  into v_contact_org_id, v_contact_account_id
  from public.contacts c
  where c.id = p_contact_id;

  if v_contact_org_id is null then
    raise exception 'Contact not found';
  end if;
  if v_contact_org_id <> v_org_id then
    raise exception 'Contact must belong to your organization';
  end if;
  if v_contact_account_id is null then
    raise exception 'Contact must have account_id';
  end if;
  if v_contact_account_id <> p_account_id then
    raise exception 'contact.account_id must match p_account_id';
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

  if p_property_id is not null then
    select p.org_id
    into v_property_org_id
    from public.properties p
    where p.id = p_property_id;

    if v_property_org_id is null then
      raise exception 'Property not found';
    end if;
    if v_property_org_id <> v_org_id then
      raise exception 'Property must belong to your organization';
    end if;
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

  insert into public.touchpoints (
    org_id,
    rep_user_id,
    property_id,
    account_id,
    contact_id,
    touchpoint_type_id,
    outcome_id,
    engagement_phase,
    happened_at,
    notes,
    created_by
  )
  values (
    v_org_id,
    v_uid,
    p_property_id,
    p_account_id,
    p_contact_id,
    p_touchpoint_type_id,
    p_outcome_id,
    v_engagement_phase,
    coalesce(p_happened_at, now()),
    p_notes,
    v_uid
  )
  returning id into v_touchpoint_id;

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
      v_touchpoint_id,
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

  select count(*)
  into v_outreach_count
  from public.touchpoints t
  join public.touchpoint_types tt on tt.id = t.touchpoint_type_id
  where t.org_id = v_org_id
    and t.rep_user_id = v_uid
    and t.contact_id is not null
    and coalesce(tt.is_outreach, false)
    and (t.happened_at at time zone 'utc')::date = (now() at time zone 'utc')::date;

  select kt.target_value
  into v_target
  from public.kpi_targets kt
  join public.kpi_definitions kd
    on kd.id = kt.kpi_definition_id
  where kt.org_id = v_org_id
    and kt.user_id = v_uid
    and kt.period = 'daily'
    and kd.key = 'daily_outreach_touchpoints'
    and (kd.org_id = v_org_id or kd.org_id is null)
  order by (kd.org_id is null), kt.created_at desc
  limit 1;

  if v_target is null then
    v_target := 20;
  end if;

  return query
  select
    v_touchpoint_id,
    coalesce(v_points, 0),
    v_outreach_count,
    v_target,
    greatest(v_target - v_outreach_count, 0);
end;
$$;

revoke all on function public.rpc_log_outreach_touchpoint(
  uuid, uuid, uuid, uuid, uuid, text, timestamptz, text
) from public;
grant execute on function public.rpc_log_outreach_touchpoint(
  uuid, uuid, uuid, uuid, uuid, text, timestamptz, text
) to authenticated;

commit;
