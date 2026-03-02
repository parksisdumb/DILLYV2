begin;

-- Keep one-org-per-user invariant explicit for seed idempotency.
create unique index if not exists org_users_user_id_unique
  on public.org_users (user_id);

-- Seed idempotency helpers for assignment tables.
create unique index if not exists property_assignments_org_property_user_unique
  on public.property_assignments (org_id, property_id, user_id);

create unique index if not exists opportunity_assignments_org_opportunity_user_unique
  on public.opportunity_assignments (org_id, opportunity_id, user_id);

-- Full unique indexes are required for API ON CONFLICT (partial indexes are not enough).
create unique index if not exists scope_types_org_key_unique
  on public.scope_types (org_id, key);

create unique index if not exists opportunity_stages_org_key_unique
  on public.opportunity_stages (org_id, key);

create unique index if not exists touchpoint_types_org_key_unique
  on public.touchpoint_types (org_id, key);

create unique index if not exists touchpoint_outcomes_org_key_unique
  on public.touchpoint_outcomes (org_id, key);

create unique index if not exists milestone_types_org_key_unique
  on public.milestone_types (org_id, key);

create unique index if not exists lost_reason_types_org_key_unique
  on public.lost_reason_types (org_id, key);

commit;
