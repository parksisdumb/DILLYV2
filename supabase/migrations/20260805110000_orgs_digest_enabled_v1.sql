-- Per-org allowlist for the follow-up digest cron. The cron only emails orgs with
-- follow_up_digest_enabled = true, so dev/test orgs (Dilly Dev, Test Org) and
-- not-yet-briefed clients (Island, Peterson) never receive real 7 AM mail.
--
-- Extend WITHOUT a deploy — just flip the boolean (takes effect next 7 AM run):
--   update public.orgs set follow_up_digest_enabled = true where name = 'Island Roofing';
--   update public.orgs set follow_up_digest_enabled = false where name = 'RoofWorx';  -- pause one
--
-- Fail-safe: if this column is absent, the cron refuses to send (errors loudly on
-- the /admin card) rather than blasting every org.

alter table public.orgs
  add column if not exists follow_up_digest_enabled boolean not null default false;

-- Launch cohort: FOX Roofing + RoofWorx only. Case-insensitive so a stray space or
-- capitalization difference still matches. Verify after applying:
--   select name, follow_up_digest_enabled from public.orgs order by name;
update public.orgs
  set follow_up_digest_enabled = true
  where lower(trim(name)) in ('fox roofing', 'roofworx');
