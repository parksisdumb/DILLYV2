-- Fix: contact-first next_actions (property_id IS NULL) were silently rejected by
-- the next_actions INSERT RLS policy, which required
--   public.has_property_access(org_id, property_id)
-- That helper is:
--   is_manager(org) OR exists(property_assignments for this user + this property)
-- so for a NON-manager with property_id NULL it evaluates to FALSE — every
-- follow-up on a contact WITHOUT a property (the contact-first norm) failed the
-- WITH CHECK and was dropped by RLS. This affected ALL client-side logging
-- surfaces equally (Grow form, contact/account/property detail panels, Focus,
-- Quick Log), not just one.
--
-- Evidence at time of fix: 0 of 28 next_actions rows in prod had a NULL
-- property_id, despite next_actions being contact-first with property optional.
--
-- Correct model: property access governs READ visibility, not whether a
-- contact-first follow-up may be CREATED. Any org MEMBER may create a next_action
-- in their own org as its creator; property_id stays optional exactly as the
-- schema (nullable) and product rules intend.
--
-- Idempotent: drops every known historical variant of the insert policy first,
-- then installs the single correct one.

drop policy if exists next_actions_insert on public.next_actions;
drop policy if exists next_actions_insert_my_org on public.next_actions;
drop policy if exists next_actions_insert_member_locked on public.next_actions;
drop policy if exists next_actions_insert_org_member_contact_first on public.next_actions;

create policy next_actions_insert_org_member_contact_first
on public.next_actions
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and public.rls_is_org_member(org_id)
);

-- Belt-and-suspenders: ask PostgREST to reload (policy changes are live in the DB
-- immediately; this just clears any cached schema/role introspection).
notify pgrst, 'reload schema';
