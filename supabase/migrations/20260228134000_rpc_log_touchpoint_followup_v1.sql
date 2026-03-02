begin;

drop function if exists public.rpc_log_touchpoint(
  uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text, uuid, uuid
);
drop function if exists public.rpc_log_touchpoint(
  uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text, uuid, uuid, text
);

create function public.rpc_log_touchpoint(
  p_property_id uuid,
  p_account_id uuid default null,
  p_contact_id uuid default null,
  p_opportunity_id uuid default null,
  p_touchpoint_type_id uuid default null,
  p_outcome_id uuid default null,
  p_happened_at timestamptz default now(),
  p_notes text default null,
  p_rep_user_id uuid default auth.uid(),
  p_complete_next_action_id uuid default null,
  p_engagement_phase text default 'other'
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
  v_contact_account_id uuid;
  v_opp_org_id uuid;
  v_type_org_id uuid;
  v_type_is_outreach boolean := false;
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
  v_resolved_account_id uuid := p_account_id;
  v_engagement_phase text := coalesce(nullif(btrim(coalesce(p_engagement_phase, '')), ''), 'other');
begin
  select m.org_id, m.role into v_org_id, v_role
  from public.rpc_get_my_org() m;

  if p_rep_user_id is null then
    raise exception 'rep_user_id is required';
  end if;

  if p_touchpoint_type_id is null then
    raise exception 'touchpoint_type_id is required';
  end if;

  if v_engagement_phase not in ('first_touch', 'follow_up', 'other') then
    raise exception 'engagement_phase must be first_touch, follow_up, or other';
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

  if p_contact_id is not null then
    select c.org_id, c.account_id
    into v_contact_org_id, v_contact_account_id
    from public.contacts c
    where c.id = p_contact_id;

    if v_contact_org_id is null or v_contact_org_id <> v_org_id then
      raise exception 'Contact must belong to your organization';
    end if;

    if v_contact_account_id is not null and v_resolved_account_id is null then
      v_resolved_account_id := v_contact_account_id;
    end if;
  end if;

  if v_resolved_account_id is null then
    select pa.account_id
    into v_resolved_account_id
    from public.property_accounts pa
    where pa.org_id = v_org_id
      and pa.property_id = p_property_id
      and coalesce(pa.active, true)
      and (pa.starts_on is null or pa.starts_on <= current_date)
      and (pa.ends_on is null or pa.ends_on >= current_date)
    order by pa.is_primary desc, pa.created_at desc
    limit 1;
  end if;

  if v_resolved_account_id is not null then
    select a.org_id into v_account_org_id
    from public.accounts a
    where a.id = v_resolved_account_id;

    if v_account_org_id is null or v_account_org_id <> v_org_id then
      raise exception 'Account must belong to your organization';
    end if;
  end if;

  if p_account_id is not null and v_contact_account_id is not null and p_account_id <> v_contact_account_id then
    raise exception 'contact.account_id must match p_account_id';
  end if;

  if p_opportunity_id is not null then
    select o.org_id into v_opp_org_id
    from public.opportunities o
    where o.id = p_opportunity_id;
    if v_opp_org_id is null or v_opp_org_id <> v_org_id then
      raise exception 'Opportunity must belong to your organization';
    end if;
  end if;

  select
    tt.org_id,
    coalesce(tt.is_outreach, false)
  into v_type_org_id, v_type_is_outreach
  from public.touchpoint_types tt
  where tt.id = p_touchpoint_type_id;

  if not found then
    raise exception 'Touchpoint type not found';
  end if;

  if v_type_org_id is not null and v_type_org_id <> v_org_id then
    raise exception 'Touchpoint type is not in your organization';
  end if;

  if v_type_is_outreach and p_contact_id is null then
    raise exception 'contact_id is required for outreach touchpoints';
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

  insert into public.touchpoints (
    org_id, rep_user_id, property_id, account_id, contact_id, opportunity_id,
    touchpoint_type_id, outcome_id, engagement_phase, happened_at, notes, created_by
  )
  values (
    v_org_id, p_rep_user_id, p_property_id, v_resolved_account_id, p_contact_id, p_opportunity_id,
    p_touchpoint_type_id, p_outcome_id, v_engagement_phase, coalesce(p_happened_at, now()), p_notes, auth.uid()
  )
  returning id into v_touchpoint_id;

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
  uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text, uuid, uuid, text
) from public;
grant execute on function public.rpc_log_touchpoint(
  uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text, uuid, uuid, text
) to authenticated;

commit;
