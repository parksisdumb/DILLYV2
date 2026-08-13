-- backfill_engagement_phase_v1
--
-- One-time historical correction. Relabels OUTREACH touchpoints' engagement_phase
-- for FOX Roofing + RoofWorx per the rule the logging RPCs now enforce
-- (derive_engagement_phase_v1 / migration 90): rank each anchor's REAL (scored)
-- touchpoints by (happened_at, id) — the earliest is first_touch, the rest
-- follow_up. Anchor = contact_id, else property_id. Only outreach touchpoints are
-- relabeled; non-outreach + passive (visibility) touches are left untouched.
--
-- Scope: FOX + RoofWorx only (Dilly Dev / test orgs intentionally skipped).
-- Expected ~260 rows (FOX ~231, RoofWorx ~29) — the exact live count depends on
-- activity at apply time; the STEP-1 preview in the scratchpad prints it.
--
-- IMPORTANT: apply migration 90 (derive_engagement_phase_v1) and confirm the
-- derivation is live BEFORE running this, so new logs and history agree.
--
-- Immutability: touchpoints are the immutable ledger. This is a superuser one-time
-- correction of a SYSTEM-set classification (not the interaction content), and it
-- is NOT silent — every relabel writes a touchpoint_revisions audit row. Phase
-- feeds neither score_events nor streaks, so no points or streaks move.
--
-- Idempotent: re-running is a no-op (rows already match → nothing changes, no
-- duplicate revisions). Apply via the SQL editor.

begin;

-- System-initiated revisions have no human actor: allow revised_by NULL (= system).
alter table public.touchpoint_revisions alter column revised_by drop not null;

-- Compute the relabel set once, so the audit rows and the update use exactly the
-- same rows.
create temp table _phase_changes on commit drop as
with scored as (
  select
    t.id,
    t.org_id,
    t.engagement_phase as old_phase,
    coalesce(t.contact_id::text, 'p:' || t.property_id::text) as anchor,
    t.happened_at,
    coalesce(tt.is_outreach, false) as is_outreach
  from public.touchpoints t
  join public.touchpoint_types tt on tt.id = t.touchpoint_type_id
  where t.org_id in (
      'e8363ed5-bc57-492c-bcbf-7cd477b62386',  -- FOX Roofing
      'c28da562-2ad2-4ed4-927a-012b09dd0642'   -- RoofWorx
    )
    and exists (select 1 from public.score_events se where se.touchpoint_id = t.id)
    and (t.contact_id is not null or t.property_id is not null)
),
ranked as (
  select
    id, org_id, old_phase, is_outreach,
    case
      when row_number() over (partition by org_id, anchor order by happened_at asc, id asc) = 1
        then 'first_touch'
      else 'follow_up'
    end as new_phase
  from scored
)
select id, org_id, old_phase, new_phase
from ranked
where is_outreach
  and old_phase is distinct from new_phase;

-- 1) Audit trail FIRST — a visible correction, not a silent one.
insert into public.touchpoint_revisions (org_id, touchpoint_id, revised_by, reason, before, after)
select
  c.org_id,
  c.id,
  null,  -- system
  'System backfill: engagement_phase derived from touch history (migration derive_engagement_phase_v1). Corrects the prior screen-based default.',
  jsonb_build_object('engagement_phase', c.old_phase),
  jsonb_build_object('engagement_phase', c.new_phase)
from _phase_changes c;

-- 2) Then relabel. Only engagement_phase changes, so the
--    require-contact-for-outreach trigger (fires only on type/contact/direction
--    updates) does not run.
update public.touchpoints t
set engagement_phase = c.new_phase
from _phase_changes c
where c.id = t.id;

commit;
