-- Migration 82: Backfill (restore) follow-ups that the next_actions insert bug
-- silently dropped before migrations 80 + 81 fixed it.
--
-- SCOPE (deliberately narrow — only provable intent):
--   touchpoints with happened_at in [2026-07-24, 2026-07-29) America/Chicago,
--   i.e. on/after the cadence-engine deploy (when the follow-up toggle defaulted
--   ON) and before the fix landed. A non-terminal-outcome touchpoint in that
--   window with NO linked next_action is a follow-up the rep intended but the bug
--   dropped. Pre-cadence touchpoints are NOT restored (no provable intent — cold
--   detection covers those). The upper bound also makes this safe to re-run: it
--   never resurrects a follow-up a rep legitimately declined after the fix.
--
-- For each such touchpoint we recreate exactly what the cadence engine would have
-- made: due = the touchpoint's Central calendar date + the outcome's cadence
-- offset, at 09:00 Central; assigned to / created by the logging rep; linked back
-- via created_from_touchpoint_id. Offsets/notes mirror src/lib/constants/cadence.ts.
-- Terminal outcomes (won / lost / email_bounced / not_available) are excluded.
--
-- CONSTRAINTS HONORED:
--   * Idempotent — NOT EXISTS guard on created_from_touchpoint_id; re-running
--     restores nothing twice.
--   * No score / streak side effects — a plain INSERT of 'open' next_actions never
--     touches score_events or streaks (those fire only from touchpoint RPCs and
--     from next_action COMPLETION, never from an insert).
--   * Annotation — every restored note begins "Restored — originally scheduled
--     <date> (system error)" so reps understand why the item appeared in queue.
--
-- Expected: 5 rows (FOX Roofing 2, RoofWorx 3) as previewed on 2026-07-28.

with restored as (
  select
    t.id                 as tp_id,
    t.org_id             as org_id,
    t.created_by         as user_id,     -- the rep who logged the touchpoint
    t.contact_id         as contact_id,
    t.account_id         as account_id,
    t.property_id        as property_id, -- null for the contact-first ones
    t.touchpoint_type_id as type_id,
    ( (t.happened_at at time zone 'America/Chicago')::date
      + case o.key
          when 'connected_conversation' then 7
          when 'connected'              then 7
          when 'no_answer_voicemail'    then 3
          when 'no_answer'              then 3
          when 'no_answer_no_voicemail' then 2
          when 'gatekeeper'             then 5
          when 'callback_requested'     then 1
          when 'inspection_scheduled'   then 1
          when 'inspection_set'         then 1
          when 'met_in_person'          then 10
          when 'bid_submitted'          then 5
          when 'not_interested'         then 90
          when 'email_sent'             then 4
          when 'follow_up_sent'         then 4
          when 'email_replied'          then 2
          else 3
        end
    ) as due_date_central,
    case o.key
      when 'connected_conversation' then 'Follow up on conversation'
      when 'connected'              then 'Follow up on conversation'
      when 'no_answer_voicemail'    then 'Try again'
      when 'no_answer'              then 'Try again'
      when 'no_answer_no_voicemail' then 'Try again'
      when 'gatekeeper'             then 'Try a different time or contact'
      when 'callback_requested'     then 'Return their call'
      when 'inspection_scheduled'   then 'Follow up on inspection findings'
      when 'inspection_set'         then 'Follow up on inspection findings'
      when 'met_in_person'          then 'Follow up on meeting'
      when 'bid_submitted'          then 'Check on proposal'
      when 'not_interested'         then 'Long-term nurture check-in'
      when 'email_sent'             then 'Follow up if no reply'
      when 'follow_up_sent'         then 'Follow up if no reply'
      when 'email_replied'          then 'Respond'
      else 'Follow up'
    end as cad_note
  from public.touchpoints t
  join public.touchpoint_outcomes o on o.id = t.outcome_id
  where t.happened_at >= (timestamp '2026-07-24 00:00:00' at time zone 'America/Chicago')
    and t.happened_at <  (timestamp '2026-07-29 00:00:00' at time zone 'America/Chicago')
    and o.key not in ('won', 'lost', 'email_bounced', 'not_available')
    and t.contact_id is not null
    and t.account_id is not null
    and not exists (
      select 1 from public.next_actions na
      where na.created_from_touchpoint_id = t.id
    )
)
insert into public.next_actions (
  org_id, assigned_user_id, contact_id, account_id, property_id,
  status, due_at, notes, recommended_touchpoint_type_id,
  created_from_touchpoint_id, created_by
)
select
  org_id,
  user_id,
  contact_id,
  account_id,
  property_id,
  'open',
  (due_date_central::timestamp + time '09:00:00') at time zone 'America/Chicago',
  'Restored — originally scheduled ' || to_char(due_date_central, 'Mon FMDD') || ' (system error). ' || cad_note,
  type_id,
  tp_id,
  user_id
from restored;
