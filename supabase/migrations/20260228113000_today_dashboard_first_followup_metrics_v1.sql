begin;

drop function if exists public.rpc_today_dashboard();

create function public.rpc_today_dashboard()
returns table(
  points_today int,
  outreach_today int,
  outreach_target numeric,
  outreach_remaining numeric,
  first_touch_outreach_today int,
  follow_up_outreach_today int,
  target_first_touch_outreach numeric,
  target_follow_up_outreach numeric,
  remaining_first_touch_outreach numeric,
  remaining_follow_up_outreach numeric,
  next_actions_due_today int,
  next_actions_overdue int,
  streak int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_role text;
  v_points_today int := 0;
  v_outreach_count int := 0;
  v_target numeric := 20;
  v_first_touch_count int := 0;
  v_follow_up_count int := 0;
  v_target_first numeric := 20;
  v_target_follow numeric := 10;
  v_due_today int := 0;
  v_overdue int := 0;
  v_streak int := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select m.org_id, m.role into v_org_id, v_role
  from public.rpc_get_my_org() m;

  select coalesce(sum(se.points), 0)::int
  into v_points_today
  from public.score_events se
  where se.org_id = v_org_id
    and se.user_id = v_uid
    and (se.created_at at time zone 'utc')::date = (now() at time zone 'utc')::date;

  select count(*)
  into v_outreach_count
  from public.touchpoints t
  join public.touchpoint_types tt on tt.id = t.touchpoint_type_id
  where t.org_id = v_org_id
    and t.rep_user_id = v_uid
    and t.contact_id is not null
    and coalesce(tt.is_outreach, false)
    and (t.happened_at at time zone 'utc')::date = (now() at time zone 'utc')::date;

  select count(*)
  into v_first_touch_count
  from public.touchpoints t
  join public.touchpoint_types tt on tt.id = t.touchpoint_type_id
  where t.org_id = v_org_id
    and t.rep_user_id = v_uid
    and t.contact_id is not null
    and coalesce(tt.is_outreach, false)
    and t.engagement_phase = 'first_touch'
    and (t.happened_at at time zone 'utc')::date = (now() at time zone 'utc')::date;

  select count(*)
  into v_follow_up_count
  from public.touchpoints t
  join public.touchpoint_types tt on tt.id = t.touchpoint_type_id
  where t.org_id = v_org_id
    and t.rep_user_id = v_uid
    and coalesce(tt.is_outreach, false)
    and t.engagement_phase = 'follow_up'
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

  select kt.target_value
  into v_target_first
  from public.kpi_targets kt
  join public.kpi_definitions kd
    on kd.id = kt.kpi_definition_id
  where kt.org_id = v_org_id
    and kt.user_id = v_uid
    and kt.period = 'daily'
    and kd.key = 'daily_first_touch_outreach'
    and (kd.org_id = v_org_id or kd.org_id is null)
  order by (kd.org_id is null), kt.created_at desc
  limit 1;

  if v_target_first is null then
    v_target_first := 20;
  end if;

  select kt.target_value
  into v_target_follow
  from public.kpi_targets kt
  join public.kpi_definitions kd
    on kd.id = kt.kpi_definition_id
  where kt.org_id = v_org_id
    and kt.user_id = v_uid
    and kt.period = 'daily'
    and kd.key = 'daily_follow_up_outreach'
    and (kd.org_id = v_org_id or kd.org_id is null)
  order by (kd.org_id is null), kt.created_at desc
  limit 1;

  if v_target_follow is null then
    v_target_follow := 10;
  end if;

  select count(*)
  into v_due_today
  from public.next_actions na
  where na.org_id = v_org_id
    and na.assigned_user_id = v_uid
    and na.status = 'open'
    and (na.due_at at time zone 'utc')::date = (now() at time zone 'utc')::date;

  select count(*)
  into v_overdue
  from public.next_actions na
  where na.org_id = v_org_id
    and na.assigned_user_id = v_uid
    and na.status = 'open'
    and (na.due_at at time zone 'utc')::date < (now() at time zone 'utc')::date;

  select coalesce(s.current_count, 0)
  into v_streak
  from public.streaks s
  where s.org_id = v_org_id
    and s.user_id = v_uid
    and s.streak_type = 'daily_outreach'
  limit 1;

  return query
  select
    v_points_today,
    v_outreach_count,
    v_target,
    greatest(v_target - v_outreach_count, 0),
    v_first_touch_count,
    v_follow_up_count,
    v_target_first,
    v_target_follow,
    greatest(v_target_first - v_first_touch_count, 0),
    greatest(v_target_follow - v_follow_up_count, 0),
    v_due_today,
    v_overdue,
    coalesce(v_streak, 0);
end;
$$;

revoke all on function public.rpc_today_dashboard() from public;
grant execute on function public.rpc_today_dashboard() to authenticated;

commit;
