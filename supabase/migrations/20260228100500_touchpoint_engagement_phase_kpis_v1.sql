begin;

-- 1) Touchpoint engagement phase
alter table if exists public.touchpoints
  add column if not exists engagement_phase text default 'other';

update public.touchpoints
set engagement_phase = 'other'
where engagement_phase is null;

alter table if exists public.touchpoints
  alter column engagement_phase set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.touchpoints'::regclass
      and c.conname = 'touchpoints_engagement_phase_check'
  ) then
    alter table public.touchpoints
      add constraint touchpoints_engagement_phase_check
      check (engagement_phase in ('first_touch', 'follow_up', 'other'));
  end if;
end $$;

-- 2) Ensure KPI definitions exist (global + org)
with defaults as (
  select *
  from (values
    (
      'daily_first_touch_outreach',
      'Daily First Touch Outreach',
      'count',
      'touchpoint',
      'first_touch_outreach'
    ),
    (
      'daily_follow_up_outreach',
      'Daily Follow Up Outreach',
      'count',
      'touchpoint',
      'follow_up_outreach'
    )
  ) as d(key, name, metric_type, entity_type, entity_event)
)
insert into public.kpi_definitions (org_id, key, name, metric_type, entity_type, entity_event)
select null::uuid, d.key, d.name, d.metric_type, d.entity_type, d.entity_event
from defaults d
on conflict (key) where org_id is null
do update set
  name = excluded.name,
  metric_type = excluded.metric_type,
  entity_type = excluded.entity_type,
  entity_event = excluded.entity_event;

with defaults as (
  select *
  from (values
    (
      'daily_first_touch_outreach',
      'Daily First Touch Outreach',
      'count',
      'touchpoint',
      'first_touch_outreach'
    ),
    (
      'daily_follow_up_outreach',
      'Daily Follow Up Outreach',
      'count',
      'touchpoint',
      'follow_up_outreach'
    )
  ) as d(key, name, metric_type, entity_type, entity_event)
)
insert into public.kpi_definitions (org_id, key, name, metric_type, entity_type, entity_event)
select o.id, d.key, d.name, d.metric_type, d.entity_type, d.entity_event
from public.orgs o
cross join defaults d
on conflict (org_id, key) where org_id is not null
do update set
  name = excluded.name,
  metric_type = excluded.metric_type,
  entity_type = excluded.entity_type,
  entity_event = excluded.entity_event;

-- 3) Seed rep targets for new KPIs (idempotent, no overwrite)
with target_defaults as (
  select *
  from (values
    ('daily_first_touch_outreach', 20::numeric),
    ('daily_follow_up_outreach', 10::numeric)
  ) as t(kpi_key, target_value)
)
insert into public.kpi_targets (
  org_id,
  user_id,
  period,
  kpi_definition_id,
  target_value,
  created_by
)
select
  ou.org_id,
  ou.user_id,
  'daily',
  kd.id,
  td.target_value,
  null::uuid
from public.org_users ou
join target_defaults td on true
join public.kpi_definitions kd
  on kd.org_id = ou.org_id
 and kd.key = td.kpi_key
where lower(ou.role) = 'rep'
on conflict (org_id, user_id, period, kpi_definition_id)
do nothing;

commit;
