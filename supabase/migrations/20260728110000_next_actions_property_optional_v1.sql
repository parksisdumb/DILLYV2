-- Second half of the contact-first follow-up fix (see migration 80).
--
-- A genuine end-to-end test (inserting as a real authenticated rep via JWT, so
-- RLS is actually enforced) revealed a SECOND blocker beyond the RLS policy:
--   ERROR 23502: null value in column "property_id" of relation "next_actions"
--                violates not-null constraint
-- i.e. next_actions.property_id is NOT NULL, so a contact-first follow-up (no
-- property) is rejected at the column constraint even after migration 80 fixed
-- the RLS insert policy. Migration 80 was necessary but not sufficient.
--
-- next_actions are contact-first by design (CLAUDE.md: contact_id/account_id are
-- the required anchors; property is optional context). property_id must be
-- nullable — the same relaxation already applied to touchpoints.property_id in
-- migration 28 (20260228125000). The FK (on delete cascade) is unaffected by
-- nullability.
--
-- Idempotent: drop not null is a no-op if the column is already nullable.
alter table public.next_actions
  alter column property_id drop not null;

-- Policy/columns are live immediately; nudge PostgREST to refresh its cache.
notify pgrst, 'reload schema';
