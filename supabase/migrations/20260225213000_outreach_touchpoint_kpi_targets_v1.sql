begin;

-- 1) Outreach classification on touchpoint types.
alter table if exists public.touchpoint_types
  add column if not exists is_outreach boolean not null default false;

with default_touchpoint_types as (
  select *
  from (values
    ('call', 'Call', 10, true),
    ('email', 'Email', 20, true),
    ('text', 'Text', 30, true),
    ('door_knock', 'Door Knock', 40, true),
    ('site_visit', 'Site Visit', 50, true),
    ('inspection', 'Inspection', 60, false),
    ('bid_sent', 'Bid Sent', 70, false),
    ('meeting', 'Meeting', 80, false)
  ) as t(key, name, sort_order, is_outreach)
)
insert into public.touchpoint_types (org_id, key, name, sort_order, is_outreach)
select null::uuid, d.key, d.name, d.sort_order, d.is_outreach
from default_touchpoint_types d
on conflict (key) where org_id is null
  do update
  set name = excluded.name,
      sort_order = excluded.sort_order,
      is_outreach = excluded.is_outreach;

with default_touchpoint_types as (
  select *
  from (values
    ('call', 'Call', 10, true),
    ('email', 'Email', 20, true),
    ('text', 'Text', 30, true),
    ('door_knock', 'Door Knock', 40, true),
    ('site_visit', 'Site Visit', 50, true),
    ('inspection', 'Inspection', 60, false),
    ('bid_sent', 'Bid Sent', 70, false),
    ('meeting', 'Meeting', 80, false)
  ) as t(key, name, sort_order, is_outreach)
)
insert into public.touchpoint_types (org_id, key, name, sort_order, is_outreach)
select o.id, d.key, d.name, d.sort_order, d.is_outreach
from public.orgs o
cross join default_touchpoint_types d
on conflict (org_id, key) where org_id is not null
  do update
  set is_outreach = excluded.is_outreach;

update public.touchpoint_types
set is_outreach = true
where key in ('call', 'email', 'text', 'door_knock', 'site_visit');

update public.touchpoint_types
set is_outreach = false
where key in ('inspection', 'bid_sent', 'meeting');

-- 2) KPI definitions uniqueness and default KPI definitions.
create unique index if not exists kpi_definitions_org_key_unique
  on public.kpi_definitions (org_id, key);

with default_kpi_definitions as (
  select *
  from (values
    (
      'daily_outreach_touchpoints',
      'Daily Outreach Touchpoints',
      'count',
      'touchpoint',
      'outreach'
    ),
    (
      'daily_next_actions_completed',
      'Daily Next Actions Completed',
      'count',
      'next_action',
      'completed'
    )
  ) as d(key, name, metric_type, entity_type, entity_event)
)
insert into public.kpi_definitions (org_id, key, name, metric_type, entity_type, entity_event)
select null::uuid, d.key, d.name, d.metric_type, d.entity_type, d.entity_event
from default_kpi_definitions d
on conflict (key) where org_id is null
  do update
  set name = excluded.name,
      metric_type = excluded.metric_type,
      entity_type = excluded.entity_type,
      entity_event = excluded.entity_event;

with default_kpi_definitions as (
  select *
  from (values
    (
      'daily_outreach_touchpoints',
      'Daily Outreach Touchpoints',
      'count',
      'touchpoint',
      'outreach'
    ),
    (
      'daily_next_actions_completed',
      'Daily Next Actions Completed',
      'count',
      'next_action',
      'completed'
    )
  ) as d(key, name, metric_type, entity_type, entity_event)
)
insert into public.kpi_definitions (org_id, key, name, metric_type, entity_type, entity_event)
select o.id, d.key, d.name, d.metric_type, d.entity_type, d.entity_event
from public.orgs o
cross join default_kpi_definitions d
on conflict (org_id, key) where org_id is not null
  do update
  set name = excluded.name,
      metric_type = excluded.metric_type,
      entity_type = excluded.entity_type,
      entity_event = excluded.entity_event;

-- 3) KPI target uniqueness for per-user targets.
with ranked as (
  select
    id,
    row_number() over (
      partition by org_id, user_id, period, kpi_definition_id
      order by created_at desc, id desc
    ) as rn
  from public.kpi_targets
)
delete from public.kpi_targets t
using ranked r
where t.id = r.id
  and r.rn > 1;

create unique index if not exists kpi_targets_org_user_period_definition_unique
  on public.kpi_targets (org_id, user_id, period, kpi_definition_id);

-- 4) Seed default per-rep KPI targets (idempotent, no overwrite on existing).
with target_defaults as (
  select *
  from (values
    ('daily_outreach_touchpoints', 20::numeric),
    ('daily_next_actions_completed', 5::numeric)
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
join target_defaults td
  on true
join public.kpi_definitions kd
  on kd.org_id = ou.org_id
 and kd.key = td.kpi_key
where lower(ou.role) = 'rep'
on conflict (org_id, user_id, period, kpi_definition_id)
  do nothing;

commit;
