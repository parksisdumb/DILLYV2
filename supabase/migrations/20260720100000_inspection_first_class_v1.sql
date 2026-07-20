-- inspection_first_class_v1
--
-- Make "inspection" a first-class ACTIVITY that shows up in the outreach/logging
-- flows and scores like a booked inspection.
--
-- Background: the global + per-org 'inspection' touchpoint_type already exists
-- (seeded in 20260225213000) but with is_outreach=false, so it never appeared in
-- the "how did you reach out?" chip rows, the Advance list, or the activity-view
-- type filter (all of which filter to is_outreach=true).
--
-- This migration:
--   1. Upserts a GLOBAL 'inspection' type (idempotent) in case an env lacks it.
--   2. Flips is_outreach=true for EVERY inspection type row (global + per-org) so
--      it surfaces in the logging flows.
--   3. Seeds a type-level score_rule (10 pts) for each inspection type row, so an
--      inspection touchpoint scores 10 regardless of outcome — matching the
--      existing inspection_scheduled outcome rule (also 10 pts, seeded in
--      20260613100000). The scoring RPCs pick the most-specific rule; a type-only
--      and an outcome-only rule both score 10 here, so either path yields 10.
--
-- NOTE: like all migrations in this repo, this must be applied to prod manually
-- (prod `db push` is blocked for the local CLI account).

begin;

-- 1) Ensure the GLOBAL inspection type exists.
insert into public.touchpoint_types (org_id, key, name, sort_order, is_outreach)
values (null, 'inspection', 'Inspection', 60, true)
on conflict (key) where org_id is null
  do update set name = excluded.name, is_outreach = true;

-- 2) Make inspection an outreach/logging activity everywhere (global + per-org rows).
update public.touchpoint_types
set is_outreach = true
where key = 'inspection';

-- 3) Type-level score rule: any inspection touchpoint = 10 pts.
--    One rule per inspection type row (global + per-org) so whichever type_id the
--    org actually logs against has a matching rule. Idempotent.
insert into public.score_rules (org_id, touchpoint_type_id, outcome_id, points)
select tt.org_id, tt.id, null, 10
from public.touchpoint_types tt
where tt.key = 'inspection'
  and not exists (
    select 1 from public.score_rules sr
    where sr.touchpoint_type_id = tt.id
      and sr.outcome_id is null
  );

-- Fail loudly if no inspection rule got created/exists (should never happen).
do $$
declare v_rules int;
begin
  select count(*) into v_rules
  from public.score_rules sr
  join public.touchpoint_types tt on tt.id = sr.touchpoint_type_id
  where tt.key = 'inspection' and sr.outcome_id is null;
  if v_rules = 0 then
    raise exception 'No inspection type-level score_rule present after seed';
  end if;
  raise notice 'inspection type-level score_rules: %', v_rules;
end $$;

commit;
