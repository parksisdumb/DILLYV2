-- Org monthly revenue target: a single dollar value per org used by the manager
-- Pipeline Health tab to compute "Pipeline coverage: total / target".
--
-- Storage: a row in kpi_targets with user_id IS NULL = org-level (vs the
-- usual per-rep targets). Existing per-rep daily targets are unaffected.
--
-- Manager+ already has insert/update/delete on kpi_targets via the locked
-- policies in 20260225220000_kpi_targets_manager_write_policy_v1.sql, so no
-- new policy is needed.

begin;

-- 1. Allow user_id to be NULL so we can store org-level targets here.
alter table public.kpi_targets alter column user_id drop not null;

-- 2. Prevent duplicate org-level target rows for the same definition+period.
--    Per-rep targets keep their existing semantics (no new constraint on them).
create unique index if not exists kpi_targets_org_level_unique
  on public.kpi_targets (org_id, kpi_definition_id, period)
  where user_id is null;

-- 3. Register the global definition. metric_type='value' marks it as a dollar
--    figure (vs the 'count' definitions used for daily outreach KPIs).
insert into public.kpi_definitions (org_id, key, name, metric_type)
values (null, 'monthly_revenue_target', 'Monthly Revenue Target', 'value')
on conflict (key) where org_id is null do nothing;

commit;
