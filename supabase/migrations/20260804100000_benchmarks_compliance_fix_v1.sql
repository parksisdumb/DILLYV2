-- rpc_calculate_benchmarks — compliance-block SCHEMA FIX (the "v2" of migration 85).
--
-- Migration 85 reproduced migration 43 verbatim (plus a score_events filter) and
-- thereby inherited a latent bug: the follow_up_compliance_rate blocks reference
-- `next_actions.due_date` and `next_actions.completed_at`, NEITHER of which exists
-- in the live schema (the columns are `due_at` and — for completion — the
-- completing touchpoint via `completed_by_touchpoint_id`; there is no completed_at).
-- So the function CREATED fine but FAILED at runtime with 42703, aborting the whole
-- transaction. The daily 3am cron (/api/cron/benchmarks, vercel.json) has been
-- failing since #43 shipped (2026-03), which is why benchmark_snapshots is empty
-- and every "Platform avg" in /app/manager/analytics shows "—".
--
-- Fix (this is a full create-or-replace; only the two compliance blocks change vs
-- #85 — validated every other table reference against the live schema):
--   * due_date            -> due_at::date
--   * completed_at         -> the completing touchpoint's happened_at, joined via
--                            completed_by_touchpoint_id (LEFT JOIN). A completed
--                            action with no completing touchpoint counts toward
--                            `total` but not `on_time` (its completion time is
--                            unknowable, so we can't claim it was on time).
-- Outreach counts keep the #85 score_events filter (real rep-logged only).
--
-- Must be applied to prod manually. After applying, `select rpc_calculate_benchmarks();`
-- should return {metrics_written, ...} and benchmark_snapshots should have rows.

create or replace function public.rpc_calculate_benchmarks(
  p_period_start  date  default (current_date - interval '30 days')::date,
  p_period_end    date  default current_date
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_metrics_written int := 0;
  v_org record;
begin
  -- ═══════════════════════════════════════════════════════════════════════════
  -- PLATFORM-WIDE METRICS (org_id = null)
  -- ═══════════════════════════════════════════════════════════════════════════

  -- 1. avg_touches_to_first_meeting  (real rep-logged outreach only)
  with first_meetings as (
    select
      t.contact_id,
      t.org_id,
      min(t.happened_at) as first_meeting_at
    from public.touchpoints t
    join public.touchpoint_types tt on tt.id = t.touchpoint_type_id
    where tt.key in ('meeting', 'inspection')
      and t.happened_at between p_period_start and p_period_end + interval '1 day'
      and t.contact_id is not null
    group by t.contact_id, t.org_id
  ),
  touch_counts as (
    select
      fm.contact_id,
      count(t.id) as outreach_count
    from first_meetings fm
    join public.touchpoints t on t.contact_id = fm.contact_id
      and t.org_id = fm.org_id
      and t.happened_at <= fm.first_meeting_at
    join public.touchpoint_types tt on tt.id = t.touchpoint_type_id
      and tt.is_outreach = true
    where exists (select 1 from public.score_events se where se.touchpoint_id = t.id)
    group by fm.contact_id
  )
  insert into public.benchmark_snapshots (period_start, period_end, org_id, metric_key, metric_value, sample_size)
  values (
    p_period_start, p_period_end, null,
    'avg_touches_to_first_meeting',
    jsonb_build_object('value', coalesce((select round(avg(outreach_count)::numeric, 1) from touch_counts), 0)),
    (select count(*) from touch_counts)
  )
  on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), period_start, period_end, metric_key)
  do update set
    metric_value = excluded.metric_value,
    sample_size = excluded.sample_size,
    created_at = now();
  v_metrics_written := v_metrics_written + 1;

  -- 2. conversion_rate_by_account_type
  with acct_stats as (
    select
      a.account_type,
      count(distinct a.id) as total_accounts,
      count(distinct case when o.status = 'won' then a.id end) as won_accounts
    from public.accounts a
    left join public.properties p on p.primary_account_id = a.id
    left join public.opportunities o on o.property_id = p.id
    where a.account_type is not null
    group by a.account_type
  )
  insert into public.benchmark_snapshots (period_start, period_end, org_id, metric_key, metric_value, sample_size)
  values (
    p_period_start, p_period_end, null,
    'conversion_rate_by_account_type',
    coalesce(
      (select jsonb_object_agg(
        account_type,
        jsonb_build_object(
          'total', total_accounts,
          'won', won_accounts,
          'rate', case when total_accounts > 0 then round((won_accounts::numeric / total_accounts) * 100, 1) else 0 end
        )
      ) from acct_stats),
      '{}'::jsonb
    ),
    (select coalesce(sum(total_accounts), 0)::int from acct_stats)
  )
  on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), period_start, period_end, metric_key)
  do update set
    metric_value = excluded.metric_value,
    sample_size = excluded.sample_size,
    created_at = now();
  v_metrics_written := v_metrics_written + 1;

  -- 3. conversion_rate_by_channel
  with channel_stats as (
    select
      tt.key as channel,
      count(distinct o.id) as total_opps,
      count(distinct case when o.status = 'won' then o.id end) as won_opps
    from public.opportunities o
    join public.touchpoints t on t.id = o.created_from_touchpoint_id
    join public.touchpoint_types tt on tt.id = t.touchpoint_type_id
    where o.opened_at between p_period_start and p_period_end + interval '1 day'
    group by tt.key
  )
  insert into public.benchmark_snapshots (period_start, period_end, org_id, metric_key, metric_value, sample_size)
  values (
    p_period_start, p_period_end, null,
    'conversion_rate_by_channel',
    coalesce(
      (select jsonb_object_agg(
        channel,
        jsonb_build_object(
          'total', total_opps,
          'won', won_opps,
          'rate', case when total_opps > 0 then round((won_opps::numeric / total_opps) * 100, 1) else 0 end
        )
      ) from channel_stats),
      '{}'::jsonb
    ),
    (select coalesce(sum(total_opps), 0)::int from channel_stats)
  )
  on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), period_start, period_end, metric_key)
  do update set
    metric_value = excluded.metric_value,
    sample_size = excluded.sample_size,
    created_at = now();
  v_metrics_written := v_metrics_written + 1;

  -- 4. pipeline_velocity
  insert into public.benchmark_snapshots (period_start, period_end, org_id, metric_key, metric_value, sample_size)
  values (
    p_period_start, p_period_end, null,
    'pipeline_velocity',
    jsonb_build_object(
      'avg_days', coalesce(
        (select round(avg(extract(epoch from (o.closed_at - o.opened_at)) / 86400)::numeric, 1)
         from public.opportunities o
         where o.status = 'won'
           and o.closed_at is not null
           and o.closed_at between p_period_start and p_period_end + interval '1 day'),
        0
      )
    ),
    (select count(*)::int
     from public.opportunities o
     where o.status = 'won'
       and o.closed_at is not null
       and o.closed_at between p_period_start and p_period_end + interval '1 day')
  )
  on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), period_start, period_end, metric_key)
  do update set
    metric_value = excluded.metric_value,
    sample_size = excluded.sample_size,
    created_at = now();
  v_metrics_written := v_metrics_written + 1;

  -- 5. follow_up_compliance_rate  (SCHEMA-FIXED: due_at + completing touchpoint)
  with acts as (
    select
      na.status,
      (na.status = 'completed'
        and ct.happened_at is not null
        and ct.happened_at <= na.due_at + interval '1 day') as on_time
    from public.next_actions na
    left join public.touchpoints ct on ct.id = na.completed_by_touchpoint_id
    where na.due_at::date between p_period_start and p_period_end
      and na.status in ('completed', 'open')
  ),
  compliance as (
    select
      count(*) as total_actions,
      count(*) filter (where on_time) as on_time
    from acts
  )
  insert into public.benchmark_snapshots (period_start, period_end, org_id, metric_key, metric_value, sample_size)
  values (
    p_period_start, p_period_end, null,
    'follow_up_compliance_rate',
    jsonb_build_object(
      'rate', coalesce(
        (select case when total_actions > 0 then round((on_time::numeric / total_actions) * 100, 1) else 0 end from compliance),
        0
      ),
      'total', (select total_actions from compliance),
      'on_time', (select on_time from compliance)
    ),
    (select total_actions::int from compliance)
  )
  on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), period_start, period_end, metric_key)
  do update set
    metric_value = excluded.metric_value,
    sample_size = excluded.sample_size,
    created_at = now();
  v_metrics_written := v_metrics_written + 1;

  -- 6. outreach_volume  (real rep-logged outreach only)
  with daily_outreach as (
    select
      (t.happened_at at time zone 'UTC')::date as day,
      count(*) as touches
    from public.touchpoints t
    join public.touchpoint_types tt on tt.id = t.touchpoint_type_id
    where tt.is_outreach = true
      and t.happened_at between p_period_start and p_period_end + interval '1 day'
      and exists (select 1 from public.score_events se where se.touchpoint_id = t.id)
    group by (t.happened_at at time zone 'UTC')::date
  )
  insert into public.benchmark_snapshots (period_start, period_end, org_id, metric_key, metric_value, sample_size)
  values (
    p_period_start, p_period_end, null,
    'outreach_volume',
    jsonb_build_object(
      'avg_daily', coalesce((select round(avg(touches)::numeric, 1) from daily_outreach), 0),
      'total', coalesce((select sum(touches) from daily_outreach), 0)
    ),
    (select count(*)::int from daily_outreach)
  )
  on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), period_start, period_end, metric_key)
  do update set
    metric_value = excluded.metric_value,
    sample_size = excluded.sample_size,
    created_at = now();
  v_metrics_written := v_metrics_written + 1;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- PER-ORG METRICS (for each org with activity in the period)
  -- ═══════════════════════════════════════════════════════════════════════════

  for v_org in
    select distinct o.id as org_id
    from public.orgs o
    join public.touchpoints t on t.org_id = o.id
    where t.happened_at between p_period_start and p_period_end + interval '1 day'
  loop

    -- Org pipeline_velocity
    insert into public.benchmark_snapshots (period_start, period_end, org_id, metric_key, metric_value, sample_size)
    values (
      p_period_start, p_period_end, v_org.org_id,
      'pipeline_velocity',
      jsonb_build_object(
        'avg_days', coalesce(
          (select round(avg(extract(epoch from (o.closed_at - o.opened_at)) / 86400)::numeric, 1)
           from public.opportunities o
           where o.org_id = v_org.org_id
             and o.status = 'won'
             and o.closed_at is not null
             and o.closed_at between p_period_start and p_period_end + interval '1 day'),
          0
        )
      ),
      (select count(*)::int
       from public.opportunities o
       where o.org_id = v_org.org_id
         and o.status = 'won'
         and o.closed_at is not null
         and o.closed_at between p_period_start and p_period_end + interval '1 day')
    )
    on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), period_start, period_end, metric_key)
    do update set
      metric_value = excluded.metric_value,
      sample_size = excluded.sample_size,
      created_at = now();
    v_metrics_written := v_metrics_written + 1;

    -- Org follow_up_compliance_rate  (SCHEMA-FIXED: due_at + completing touchpoint)
    insert into public.benchmark_snapshots (period_start, period_end, org_id, metric_key, metric_value, sample_size)
    values (
      p_period_start, p_period_end, v_org.org_id,
      'follow_up_compliance_rate',
      jsonb_build_object(
        'rate', coalesce(
          (select case when count(*) > 0
            then round((count(*) filter (
                  where na.status = 'completed'
                    and ct.happened_at is not null
                    and ct.happened_at <= na.due_at + interval '1 day'
                )::numeric / count(*)) * 100, 1)
            else 0 end
           from public.next_actions na
           left join public.touchpoints ct on ct.id = na.completed_by_touchpoint_id
           where na.org_id = v_org.org_id
             and na.due_at::date between p_period_start and p_period_end
             and na.status in ('completed', 'open')),
          0
        ),
        'total', (select count(*)::int
                  from public.next_actions na
                  where na.org_id = v_org.org_id
                    and na.due_at::date between p_period_start and p_period_end
                    and na.status in ('completed', 'open')),
        'on_time', (select count(*)::int
                    from public.next_actions na
                    join public.touchpoints ct on ct.id = na.completed_by_touchpoint_id
                    where na.org_id = v_org.org_id
                      and na.due_at::date between p_period_start and p_period_end
                      and na.status = 'completed'
                      and ct.happened_at <= na.due_at + interval '1 day')
      ),
      (select count(*)::int
       from public.next_actions na
       where na.org_id = v_org.org_id
         and na.due_at::date between p_period_start and p_period_end
         and na.status in ('completed', 'open'))
    )
    on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), period_start, period_end, metric_key)
    do update set
      metric_value = excluded.metric_value,
      sample_size = excluded.sample_size,
      created_at = now();
    v_metrics_written := v_metrics_written + 1;

    -- Org outreach_volume  (real rep-logged outreach only)
    insert into public.benchmark_snapshots (period_start, period_end, org_id, metric_key, metric_value, sample_size)
    values (
      p_period_start, p_period_end, v_org.org_id,
      'outreach_volume',
      jsonb_build_object(
        'avg_daily', coalesce(
          (select round(avg(cnt)::numeric, 1)
           from (
             select count(*) as cnt
             from public.touchpoints t
             join public.touchpoint_types tt on tt.id = t.touchpoint_type_id
             where tt.is_outreach = true
               and t.org_id = v_org.org_id
               and t.happened_at between p_period_start and p_period_end + interval '1 day'
               and exists (select 1 from public.score_events se where se.touchpoint_id = t.id)
             group by (t.happened_at at time zone 'UTC')::date
           ) daily),
          0
        ),
        'total', coalesce(
          (select count(*)
           from public.touchpoints t
           join public.touchpoint_types tt on tt.id = t.touchpoint_type_id
           where tt.is_outreach = true
             and t.org_id = v_org.org_id
             and t.happened_at between p_period_start and p_period_end + interval '1 day'
             and exists (select 1 from public.score_events se where se.touchpoint_id = t.id)),
          0
        )
      ),
      (select count(distinct (t.happened_at at time zone 'UTC')::date)::int
       from public.touchpoints t
       join public.touchpoint_types tt on tt.id = t.touchpoint_type_id
       where tt.is_outreach = true
         and t.org_id = v_org.org_id
         and t.happened_at between p_period_start and p_period_end + interval '1 day'
         and exists (select 1 from public.score_events se where se.touchpoint_id = t.id))
    )
    on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), period_start, period_end, metric_key)
    do update set
      metric_value = excluded.metric_value,
      sample_size = excluded.sample_size,
      created_at = now();
    v_metrics_written := v_metrics_written + 1;

  end loop;

  return jsonb_build_object(
    'metrics_written', v_metrics_written,
    'period_start', p_period_start,
    'period_end', p_period_end
  );
end;
$$;
