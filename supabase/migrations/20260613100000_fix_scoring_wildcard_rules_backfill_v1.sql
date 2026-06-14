-- Fix scoring: NULL-type score_rules never matched, so score_events was empty and
-- every leaderboard/points surface read 0 despite real touchpoint activity.
--
-- Root cause: rpc_log_outreach_touchpoint / rpc_log_touchpoint matched score_rules
-- with `sr.touchpoint_type_id = p_touchpoint_type_id`. All existing rules had
-- touchpoint_type_id = NULL, and `NULL = <uuid>` is never true, so no rule ever
-- matched -> no score_events inserted. Compounded by outcome-key drift and 3 active
-- orgs (FOX Roofing, Dilly Dev Org, Peterson) where only Dilly Dev Org had any rules.
--
-- This migration:
--   PART 1: makes BOTH scoring RPCs match NULL type/outcome as a WILDCARD, with the
--           most-specific rule winning (type+outcome > outcome-only > base).
--   PART 2: seeds GLOBAL (org_id NULL) outcome-only rules using the real outcome keys.
--   PART 3: adds one GLOBAL base rule (all NULL, 1 pt) so every touchpoint scores >= 1.
--   PART 4: backfills score_events for existing touchpoints that have none, dated at
--           happened_at so weekly/monthly windows attribute correctly.
--
-- Note: score_events has no `event_type` column; the backfill marker goes in `reason`.

begin;

-- ============================================================================
-- PART 1a — rpc_log_outreach_touchpoint: resilient score-rule matching
-- ============================================================================
create or replace function public.rpc_log_outreach_touchpoint(
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

  if v_engagement_phase not in ('first_touch', 'follow_up', 'visibility') then
    raise exception 'engagement_phase must be first_touch, follow_up, or visibility';
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

  -- Resilient match: NULL type/outcome in a rule acts as a wildcard.
  -- Most specific rule wins (type+outcome > outcome-only > type-only > base),
  -- then org-specific beats global, then newest.
  select sr.points
  into v_points
  from public.score_rules sr
  where (sr.org_id = v_org_id or sr.org_id is null)
    and (sr.touchpoint_type_id = p_touchpoint_type_id or sr.touchpoint_type_id is null)
    and (sr.outcome_id = p_outcome_id or sr.outcome_id is null)
  order by
    ((sr.touchpoint_type_id is not null)::int + (sr.outcome_id is not null)::int) desc,
    (sr.org_id is not null) desc,
    sr.created_at desc
  limit 1;

  if found then
    v_has_score_rule := true;
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

-- ============================================================================
-- PART 1b — rpc_log_touchpoint: same resilient score-rule matching
-- ============================================================================
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
  p_complete_next_action_id uuid default null,
  p_engagement_phase text default 'visibility'
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
  v_engagement_phase text := coalesce(nullif(btrim(coalesce(p_engagement_phase, '')), ''), 'visibility');
begin
  select m.org_id, m.role into v_org_id, v_role
  from public.rpc_get_my_org() m;

  if p_rep_user_id is null then
    raise exception 'rep_user_id is required';
  end if;

  if p_touchpoint_type_id is null then
    raise exception 'touchpoint_type_id is required';
  end if;

  if v_engagement_phase not in ('first_touch', 'follow_up', 'visibility') then
    raise exception 'engagement_phase must be first_touch, follow_up, or visibility';
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

  -- Resilient match: NULL type/outcome in a rule acts as a wildcard.
  -- Most specific rule wins (type+outcome > outcome-only > type-only > base),
  -- then org-specific beats global, then newest.
  select sr.points
  into v_points
  from public.score_rules sr
  where (sr.org_id = v_org_id or sr.org_id is null)
    and (sr.touchpoint_type_id = p_touchpoint_type_id or sr.touchpoint_type_id is null)
    and (sr.outcome_id = p_outcome_id or sr.outcome_id is null)
  order by
    ((sr.touchpoint_type_id is not null)::int + (sr.outcome_id is not null)::int) desc,
    (sr.org_id is not null) desc,
    sr.created_at desc
  limit 1;

  if found then
    v_has_score_rule := true;
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

-- ============================================================================
-- PART 2 — Seed GLOBAL outcome-only score_rules (org_id NULL, type_id NULL).
-- Resolves the GLOBAL outcome_id by key at insert time. Idempotent.
-- ============================================================================
with rule_specs(outcome_key, points) as (
  values
    ('connected_conversation',  3),
    ('no_answer_voicemail',     1),
    ('no_answer_no_voicemail',  1),
    ('met_in_person',           5),
    ('gatekeeper',              1),
    ('inspection_scheduled',   10),
    ('not_interested',          1),
    ('callback_requested',      1),
    ('bid_submitted',          15),
    ('email_sent',              1),
    ('email_replied',           3)
)
insert into public.score_rules (org_id, touchpoint_type_id, outcome_id, points)
select null, null, oc.id, rs.points
from rule_specs rs
join public.touchpoint_outcomes oc
  on oc.org_id is null
 and oc.key = rs.outcome_key
where not exists (
  select 1 from public.score_rules sr
  where sr.org_id is null
    and sr.touchpoint_type_id is null
    and sr.outcome_id = oc.id
);

-- ============================================================================
-- PART 3 — Single GLOBAL base rule: any touchpoint earns >= 1 point.
-- ============================================================================
insert into public.score_rules (org_id, touchpoint_type_id, outcome_id, points)
select null, null, null, 1
where not exists (
  select 1 from public.score_rules sr
  where sr.org_id is null
    and sr.touchpoint_type_id is null
    and sr.outcome_id is null
);

-- Fail loudly if PART 2/3 produced nothing (migration #66 silently no-opped).
do $$
declare
  v_outcome_rules int;
  v_base_rules int;
begin
  select count(*) into v_outcome_rules
  from public.score_rules
  where org_id is null and touchpoint_type_id is null and outcome_id is not null;

  select count(*) into v_base_rules
  from public.score_rules
  where org_id is null and touchpoint_type_id is null and outcome_id is null;

  if v_outcome_rules = 0 then
    raise exception 'PART 2 produced zero global outcome rules — outcome keys did not resolve';
  end if;
  if v_base_rules = 0 then
    raise exception 'PART 3 produced no base rule';
  end if;
  raise notice 'score_rules now: % global outcome-only rules, % base rule(s)', v_outcome_rules, v_base_rules;
end $$;

-- ============================================================================
-- PART 4 — Backfill score_events for touchpoints that have none.
-- Points computed with the same resilient matching. created_at = happened_at.
-- Idempotent via NOT EXISTS on touchpoint_id (never double-scores).
-- ============================================================================
insert into public.score_events (org_id, user_id, touchpoint_id, points, reason, created_by, created_at)
select
  t.org_id,
  t.rep_user_id,
  t.id,
  coalesce((
    select sr.points
    from public.score_rules sr
    where (sr.org_id = t.org_id or sr.org_id is null)
      and (sr.touchpoint_type_id = t.touchpoint_type_id or sr.touchpoint_type_id is null)
      and (sr.outcome_id = t.outcome_id or sr.outcome_id is null)
    order by
      ((sr.touchpoint_type_id is not null)::int + (sr.outcome_id is not null)::int) desc,
      (sr.org_id is not null) desc,
      sr.created_at desc
    limit 1
  ), 0),
  'touchpoint_backfill',
  t.rep_user_id,
  t.happened_at
from public.touchpoints t
where not exists (
  select 1 from public.score_events se where se.touchpoint_id = t.id
);

do $$
declare v_backfilled int;
begin
  select count(*) into v_backfilled from public.score_events where reason = 'touchpoint_backfill';
  raise notice 'Backfilled % score_events', v_backfilled;
end $$;

commit;
