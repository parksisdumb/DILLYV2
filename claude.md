# Dilly v2 — Claude Code Project Brief

## What This Is
Dilly is a commercial construction / commercial roofing Business Development OS.
It is NOT a generic CRM. It is an execution engine focused on:
- Daily first-touch outreach (Grow)
- Disciplined follow-up (Advance)
- Territory-aware pipeline (Opportunities require a Property)
- Touchpoints as an immutable activity ledger
- KPI scoring + gamification for rep accountability
- Manager coaching surfaces

Target users: commercial roofing BD reps and their managers.
Wedge market: commercial roofing. Expansion: HVAC, plumbing, fire, specialty subs.

---

## Tech Stack
- **Framework**: Next.js 16, App Router ONLY. Never use Pages Router or getServerSideProps.
- **React**: React 19. Use `"use client"` and `"use server"` directives correctly.
- **Database**: Supabase (PostgreSQL) with Row Level Security (RLS)
- **Auth**: Supabase Auth
- **Styling**: Tailwind CSS v4. No component library. Mobile-first always.
- **Language**: TypeScript throughout.

---

## Auth & Org Context — CRITICAL

Always use `requireServerOrgContext()` from `@/lib/supabase/server-org` in Server Components and Server Actions.
```ts
const { supabase, userId, orgId } = await requireServerOrgContext();
```

- This gives you a Supabase client already scoped to the user's org via RLS.
- NEVER manually filter queries by org_id in SELECT statements — RLS handles it automatically.
- NEVER use the raw Supabase client from `@/lib/supabase/server.ts` directly in pages or actions.
- NEVER use the Supabase admin client outside of `/src/lib/supabase/admin.ts`.

---

## Writing Data — CRITICAL

For standard inserts (accounts, contacts, properties, opportunities), use the helpers in `@/lib/supabase/org-writes.ts`:
```ts
import { createAccount, createContact, createProperty, createOpportunity } from "@/lib/supabase/org-writes";
```

For logging a touchpoint, ALWAYS use an RPC — never insert into `touchpoints` directly.

**Outreach touchpoints** (call, email, text, door_knock, site_visit) — primary path:
```ts
await supabase.rpc("rpc_log_outreach_touchpoint", {
  p_contact_id: "...",           // required — uuid
  p_account_id: "...",           // required — uuid (must match contact.account_id)
  p_touchpoint_type_id: "...",   // required — uuid of outreach type
  p_property_id: "...",          // optional — uuid (omit for property-less logging)
  p_outcome_id: "...",           // optional — uuid
  p_notes: "...",                // required — free text
  p_happened_at: "...",          // optional — timestamptz, defaults to now()
  p_engagement_phase: "first_touch" | "follow_up", // optional, default 'first_touch'
});
// Returns: { touchpoint_id, awarded_points, outreach_count_today, outreach_target, outreach_remaining }
```

**Non-outreach touchpoints** (inspection, bid_sent, meeting) tied to a property:
```ts
await supabase.rpc("rpc_log_touchpoint", {
  p_property_id: "...",          // required — uuid
  p_touchpoint_type_id: "...",   // required — uuid
  p_contact_id: "...",           // optional
  p_account_id: "...",           // optional (auto-resolved from contact or property)
  p_outcome_id: "...",           // optional
  p_notes: "...",                // optional
  p_happened_at: "...",          // optional
  p_complete_next_action_id: "...", // optional — marks a next_action as completed
  p_engagement_phase: "first_touch" | "follow_up" | "visibility", // default 'visibility'
});
// Returns: { touchpoint_id, awarded_points, new_streak_values }
```

Both RPCs handle score_events and streak updates atomically.

---

## Key Database Tables

| Table | Purpose |
|---|---|
| `orgs` | Top-level tenant |
| `org_users` | User ↔ org membership with role |
| `accounts` | Companies (owners, PMs, GCs) |
| `contacts` | People, always tied to an account (`account_id` NOT NULL) |
| `properties` | Buildings — required for opportunities |
| `opportunities` | A potential job, always linked to a property |
| `touchpoints` | Immutable activity ledger (insert-only, never delete). `property_id` is nullable. |
| `next_actions` | Follow-up queue — `contact_id` and `account_id` are NOT NULL |
| `opportunity_milestones` | Key pipeline events (inspection, bid, won) |
| `score_events` | Points awarded per activity |
| `score_rules` | Configurable rules for point awards |
| `touchpoint_types` | Lookup: call, email, text, door_knock, site_visit (outreach), inspection, bid_sent, meeting (non-outreach) |
| `touchpoint_outcomes` | Lookup: connected_conversation, no_answer_voicemail, gatekeeper, inspection_scheduled, bid_submitted, won, lost |
| `kpi_definitions` | Global + org-specific KPI definitions (`key`, `name`, `metric_type`, `entity_type`) |
| `kpi_targets` | Per-user targets: `(org_id, user_id, period, kpi_definition_id, target_value)` — unique per user+period+definition |
| `streaks` | Daily streak counts per user: `(org_id, user_id, streak_type, current_count, last_earned_date)` |
| `org_invites` | Pending invitations to join an org |
| `territories` | Named geographic territories (org-scoped, manager-managed) |
| `territory_regions` | Regions within a territory — `region_type` (zip/city/county), `region_value`, `state` |
| `territory_assignments` | Rep ↔ territory assignment with `role` (primary/secondary/manager) |
| `icp_profiles` | Ideal Customer Profile definitions (org-scoped, optional territory link) |
| `icp_criteria` | Targeting criteria rows for an ICP profile — `criteria_type` + `criteria_value` |
| `prospects` | Staging table for external data (Apollo, ZoomInfo, CSV imports) — dedup on domain + address |
| `import_batches` | Tracks CSV import history — filename, row_count, duplicates_skipped |
| `suggested_outreach` | Manager-curated prospect queue for reps — status (new/accepted/dismissed/converted), reason_codes jsonb |
| `benchmark_snapshots` | Anonymized benchmark aggregates — org_id null = platform-wide, calculated by daily cron |
| `intel_prospects` | Global prospect staging (NO RLS, service role only via `createAdminClient()`) — not org-scoped |
| `intel_entities` | Institutional property owners — REITs, corporates, PMs (NO RLS) — renamed from reit_universe |
| `intel_contacts` | Contacts linked to intel_prospects or intel_entities (NO RLS) — executives, PMs, asset managers |
| `intel_tenants` | Tenant data linked to intel_prospects or intel_entities (NO RLS) — lease info, national accounts |
| `agent_registry` | Agent source config and stats (NO RLS) — agent_name PK, schedule, run counts |

---

## Enum / Key Values

**account_type** (text field on accounts):
`owner` | `commercial_property_management` | `facilities_management` | `asset_management` | `general_contractor` | `developer` | `broker` | `consultant` | `vendor` | `other`

**Touchpoint type keys** (touchpoint_types.key):
- Outreach (`is_outreach = true`): `call` | `email` | `text` | `door_knock` | `site_visit`
- Non-outreach (`is_outreach = false`): `inspection` | `bid_sent` | `meeting`

**Outcome keys** (touchpoint_outcomes.key) — important ones:
- `connected_conversation` — spoke with someone
- `no_answer_voicemail` — no answer
- `gatekeeper` — couldn't get through
- `inspection_scheduled` — qualifies opportunity
- `bid_submitted` — milestone
- `won` | `lost` — final outcomes

**Engagement phase** (touchpoints.engagement_phase):
`first_touch` | `follow_up` | `visibility`
- `first_touch` — first outreach to a contact
- `follow_up` — follow-up on a prior touchpoint
- `visibility` — passive brand presence without a conversation (drop-off, drive-by)

**KPI definition keys** (kpi_definitions.key):
`daily_outreach_touchpoints` (target: 20) | `daily_next_actions_completed` (target: 5) | `daily_first_touch_outreach` (target: 20) | `daily_follow_up_outreach` (target: 10)

**Streak types** (streaks.streak_type):
`daily_touchpoints` | `daily_next_actions` | `daily_outreach`

**Next action status**: `open` | `completed` | `snoozed`

**Opportunity status**: `open` | `won` | `lost`

**User roles** (org_users.role): `rep` | `manager` | `admin`

---

## UI / UX Rules

- **Mobile-first always.** Assume the rep is in a parking lot on their phone.
- Tailwind only — no inline styles, no CSS modules.
- Card-based layout with clear hierarchy. Use `rounded-2xl border p-4` as the base card pattern.
- Strong accent color: use a consistent color for CTAs (decide on one, e.g. `bg-blue-600`).
- Navigation: bottom tab bar on mobile, sidebar on desktop.
- Actions must be obvious — the UI's job is to tell the rep what to do next.
- Minimize typing. Favor tap/select over free text where possible.
- Never use bullet point lists inside the app UI itself.

---

## App Structure (Nav)

Primary routes under `/app/`:
- `/app/today` — Daily execution hub (Grow + Advance + Scoreboard)
- `/app/accounts` — Account list + detail
- `/app/contacts` — Contact list + detail
- `/app/properties` — Property list + detail
- `/app/opportunities` — Pipeline view
- `/app/admin/team` — Manager: team management (already built)

---

## Product Rules (Never Violate)
- Touchpoints are IMMUTABLE. Never update or delete a touchpoint row. Revisions go in `touchpoint_revisions`.
- Contacts must belong to an account. Never create an orphaned contact.
- Opportunities require a property. `property_id` on opportunities should not be null for roofing.
- Next actions are contact-first. `contact_id` is the primary key for follow-up context.
- RLS is the security layer. Do not attempt to enforce org isolation in application code.

---

## What NOT To Do
- Do NOT use the Pages Router (`/pages` directory).
- Do NOT call `supabase.auth.admin` from pages or components.
- Do NOT install component libraries (shadcn, MUI, Chakra, etc.) without asking first.
- Do NOT add `getServerSideProps` or `getStaticProps`.
- Do NOT filter by `org_id` in SELECT queries — RLS handles this.
- Do NOT auto-post or auto-send anything on behalf of users.
- Do NOT build marketing automation features.
- Do NOT skip TypeScript types — keep everything typed.

---

## Dev Environment

Local dev credentials after `npx supabase db reset && npm run seed:dev`:
- Admin: `admin@dilly.dev` / `devpassword123!`
- Local Supabase Studio: http://127.0.0.1:54323
- Local app: http://localhost:3000

Current migrations (applied in order):
1. `20260220204621_init_schema_v1` — core schema
2. `20260221000022_rls_policies_v1` — initial RLS
3. `20260221060949_rpc_core_v1` — RPCs + seed data (includes legacy `rpc_create_touchpoint_and_side_effects`)
4. `20260221075341_rpc_bootstrap_fix_v1` — bootstrap fix
5. `20260221101500_rpc_bootstrap_idempotent_v1` — idempotent bootstrap
6. `20260221113000_org_membership_lock_v1` — membership constraints
7. `20260221121500_rpc_bootstrap_org_users_idempotent_v1` — org user bootstrap
8. `20260222100000_rpc_bootstrap_lockdown_v1` — bootstrap lockdown
9. `20260222113000_align_schema_to_locked_v3_v1` — schema alignment
10. `20260222123000_rls_patch_locked_v3_v1` — RLS v3
11. `20260222133000_org_invites_v1` — org invitation system
12. `20260222143000_rpc_provision_org_owner_v1` — owner provisioning RPC
13. `20260222153000_align_schema_locked_roofing_v1` — roofing schema alignment
14. `20260222160000_rls_patch_locked_roofing_v1` — roofing RLS
15. `20260222170000_rpc_core_roofing_scoring_v1` — scoring RPCs
16. `20260225193000_seed_idempotency_constraints_v1` — seed idempotency
17. `20260225213000_outreach_touchpoint_kpi_targets_v1` — `is_outreach` on touchpoint_types, kpi_definitions + kpi_targets tables, default targets
18. `20260225220000_kpi_targets_manager_write_policy_v1` — RLS: managers can write kpi_targets
19. `20260225224500_contacts_account_required_v1` — contacts.account_id NOT NULL
20. `20260225225500_outreach_invariants_v1` — trigger: outreach touchpoints require contact_id
21. `20260225233000_rpc_log_outreach_touchpoint_v1` — `rpc_log_outreach_touchpoint` (property required)
22. `20260226000000_today_dashboard_expand_outreach_v1` — today dashboard outreach metrics
23. `20260227190500_rpc_log_outreach_touchpoint_inline_property_v1` — inline property creation in outreach RPC
24. `20260227201000_rpc_outreach_strict_ids_v1` — strict UUID-only outreach RPC
25. `20260227214500_rpc_quick_add_property_v1` — `rpc_quick_add_property`
26. `20260228100500_touchpoint_engagement_phase_kpis_v1` — engagement_phase column on touchpoints, first_touch/follow_up KPI definitions
27. `20260228113000_today_dashboard_first_followup_metrics_v1` — today dashboard phase-split metrics
28. `20260228125000_outreach_first_touch_property_optional_v1` — touchpoints.property_id nullable, `rpc_log_outreach_touchpoint` property optional (contact+account now required, property optional)
29. `20260228134000_rpc_log_touchpoint_followup_v1` — `rpc_log_touchpoint` general-purpose RPC with engagement_phase + streak support
30. `20260228142000_contacts_soft_dedupe_v1` — contact soft-dedupe constraints
31. `20260228153000_next_actions_contact_first_v1` — next_actions contact-first model
32. `20260302100000_next_actions_contact_required_v1` — next_actions.contact_id + account_id NOT NULL
33. `20260302120000_engagement_phase_visibility_v1` — renames engagement_phase 'other' → 'visibility', updates check constraint + both RPCs
34. `20260303093000_accounts_website_phone_v1` — adds `website text` and `phone text` columns to accounts table
35. `20260303110000_properties_roof_metadata_v1` — adds `roof_type text`, `roof_age_years int`, `sq_footage int` to properties table
36. `20260313100000_territories_v1` — `territories`, `territory_regions`, `territory_assignments` tables with RLS (manager/admin write, org-member read)
37. `20260313120000_icp_profiles_v1` — `icp_profiles` + `icp_criteria` tables with RLS (manager/admin write, org-member read)
38. `20260313140000_prospects_v1` — `prospects` + `import_batches` tables with dedup indexes on domain + address, RLS (manager/admin write, org-member read)
39. `20260313160000_suggested_outreach_v1` — `suggested_outreach` table with rep self-update policy, RLS (manager write, org-member read, rep update own)
40. `20260314100000_rpc_convert_prospect_v1` — `rpc_convert_prospect` RPC: atomically creates account + optional contact/property/touchpoint, marks prospect converted
41. `20260315100000_prospects_contact_fields_v1` — adds `contact_first_name`, `contact_last_name`, `contact_title` to prospects table
42. `20260315110000_rpc_convert_prospect_fix_v1` — re-creates `rpc_convert_prospect` without `updated_at` references
43. `20260316100000_benchmark_snapshots_v1` — `benchmark_snapshots` table + `rpc_calculate_benchmarks` RPC for anonymized benchmark data pipeline
44. `20260317100000_agent_runs_v1` — `agent_runs` table + `agent_metadata` jsonb column on prospects + RLS for prospecting agent
45. `20260322100000_intel_prospects_architecture_v1` — `intel_prospects` + `reit_universe` + `agent_registry` tables (NO RLS, service role only), dedup indexes, agent_registry seed data
46. `20260322110000_agent_runs_distribution_type_v1` — widens agent_runs.run_type check to include 'distribution'
47. `20260323100000_rls_performance_audit_v1` — wraps auth.uid() in SELECT subquery across all RLS policies + missing indexes
48. `20260323110000_reit_portfolio_summary_v1` — adds portfolio_summary jsonb to reit_universe, seeds reit_website_properties agent
49. `20260323120000_intel_schema_expansion_v1` — renames reit_universe → intel_entities with expanded columns, adds intel_contacts + intel_tenants tables, new intel_prospects columns (entity_id, tenant, parcel, roof_age_estimate generated, verified)