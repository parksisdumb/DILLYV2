-- Seed score_rules for the new call-outcome taxonomy.
--
-- Background: the new outcome keys (connected_conversation, no_answer_voicemail,
-- gatekeeper, inspection_scheduled, etc.) were introduced in
-- 20260403110000_call_outcome_taxonomy_v1.sql but never paired with point values.
-- The legacy score_rules seed (in scripts/seed-dev-data.ts) only covers the old
-- outcome keys (connected, no_answer, follow_up_sent, inspection_set), so
-- rpc_log_outreach_touchpoint awarded 0 points whenever a rep logged with one
-- of the new outcomes — including every touchpoint logged from Focus Mode.
--
-- This migration inserts one row per (org × touchpoint_type × outcome) for the
-- mapping below. Touchpoint_type rows are org-specific (apps prefer org-specific
-- ids over global), outcome rows are global (the new taxonomy was seeded with
-- org_id IS NULL). Existing rules are preserved — only missing combinations are
-- inserted, so this is idempotent.

begin;

with rule_specs(type_key, outcome_key, points) as (
  values
    ('call',     'connected_conversation',   3),
    ('call',     'no_answer_voicemail',      1),
    ('call',     'no_answer_no_voicemail',   1),
    ('call',     'gatekeeper',               1),
    ('call',     'inspection_scheduled',    10),
    ('call',     'not_interested',           1),
    ('call',     'callback_requested',       1),
    ('email',    'email_sent',               1),
    ('email',    'email_replied',            3),
    ('bid_sent', 'bid_submitted',           15)
)
insert into public.score_rules (org_id, touchpoint_type_id, outcome_id, points)
select
  o.id           as org_id,
  tt.id          as touchpoint_type_id,
  outc.id        as outcome_id,
  rs.points
from public.orgs o
cross join rule_specs rs
join public.touchpoint_types tt
  on tt.org_id = o.id
 and tt.key = rs.type_key
join public.touchpoint_outcomes outc
  on outc.org_id is null
 and outc.key = rs.outcome_key
where not exists (
  select 1
  from public.score_rules sr
  where sr.org_id = o.id
    and sr.touchpoint_type_id = tt.id
    and sr.outcome_id = outc.id
);

commit;
