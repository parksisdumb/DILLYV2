-- Fix: Opportunity creation is blocked for every org except Dilly Dev Org.
--
-- Root cause: opportunity_stages and scope_types had ONLY org-specific rows for
-- Dilly Dev Org and NO global (org_id IS NULL) defaults. rpc_seed_defaults() (the
-- one-time global seeder) was never run on prod, and /admin/orgs/new seeds nothing.
-- So FOX Roofing / Island / Peterson / Test Org 1 have an empty Stage dropdown and
-- an empty Scope control, and cannot create opportunities (chicken-and-egg: 0 opps,
-- 0 stages). RLS on both tables is "member_or_global", so seeding GLOBAL rows makes
-- them visible to EVERY org — current and future — with no per-org seeding.
--
-- We do NOT call rpc_seed_defaults() because it also seeds stale touchpoint/outcome
-- taxonomy. This migration seeds only the two tables that block opp creation.
--
-- Idempotent: ON CONFLICT DO NOTHING (relies on the partial unique indexes
-- scope_types_unique_global_key / opportunity_stages_unique_global_key on
-- (key) WHERE org_id IS NULL). Orgs that already have their own rows (Dilly Dev)
-- are unaffected — the app prefers org-specific rows over global (see page.tsx).

begin;

-- Global scope types (commercial roofing)
insert into public.scope_types (org_id, key, name, sort_order)
values
  (null, 'inspection',       'Inspection',       10),
  (null, 'repair',           'Repair',           20),
  (null, 'maintenance',      'Maintenance',      30),
  (null, 'reroof',           'Re-roof',          40),
  (null, 'new_construction', 'New Construction', 50)
on conflict do nothing;

-- Global opportunity stages (commercial roofing sales pipeline).
-- Proposal Sent is sort_order 50 so the analytics funnel's bid_submitted
-- fallback (sort_order 50) aligns with "reached proposal".
insert into public.opportunity_stages (org_id, key, name, sort_order, is_closed_stage)
values
  (null, 'lead',                 'Lead',                 10,  false),
  (null, 'contacted',            'Contacted',            20,  false),
  (null, 'inspection_scheduled', 'Inspection Scheduled', 30,  false),
  (null, 'inspection_complete',  'Inspection Complete',  40,  false),
  (null, 'proposal_sent',        'Proposal Sent',        50,  false),
  (null, 'negotiation',          'Negotiation',          60,  false),
  (null, 'won',                  'Won',                  90,  true),
  (null, 'lost',                 'Lost',                 100, true)
on conflict do nothing;

do $$
declare
  v_stages int;
  v_scopes int;
begin
  select count(*) into v_stages from public.opportunity_stages where org_id is null;
  select count(*) into v_scopes from public.scope_types where org_id is null;
  if v_stages = 0 then raise exception 'No global opportunity_stages after seed'; end if;
  if v_scopes = 0 then raise exception 'No global scope_types after seed'; end if;
  raise notice 'Global config: % stages, % scope types', v_stages, v_scopes;
end $$;

commit;
