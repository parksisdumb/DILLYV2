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

For logging a touchpoint (the most important write in the app), ALWAYS use the RPC:
```ts
await supabase.rpc("rpc_create_touchpoint_and_side_effects", {
  p_property_id: ...,         // uuid or null (nullable in v3+)
  p_touchpoint_type_key: ..., // e.g. "pop_in" | "call" | "email"
  p_outcome_key: ...,         // e.g. "connected_conversation" | "no_answer_voicemail"
  p_notes: ...,
  p_happened_at: ...,
  p_create_next_action: true/false,
  p_next_action_due_at: ...,
  p_complete_next_action_id: ..., // uuid of next_action to mark complete
});
```

This RPC handles touchpoint + milestone + next_action creation + score events atomically.

---

## Key Database Tables

| Table | Purpose |
|---|---|
| `orgs` | Top-level tenant |
| `org_users` | User ↔ org membership with role |
| `accounts` | Companies (owners, PMs, GCs) |
| `contacts` | People, always tied to an account |
| `properties` | Buildings — required for opportunities |
| `opportunities` | A potential job, always linked to a property |
| `touchpoints` | Immutable activity ledger (insert-only, never delete) |
| `next_actions` | Follow-up queue, contact-first |
| `opportunity_milestones` | Key pipeline events (inspection, bid, won) |
| `score_events` | Points awarded per activity |
| `score_rules` | Configurable rules for point awards |
| `touchpoint_types` | Lookup: pop_in, call, email, etc. |
| `touchpoint_outcomes` | Lookup: connected_conversation, no_answer, inspection_scheduled, etc. |

---

## Enum / Key Values

**account_type** (text field on accounts):
`owner` | `commercial_property_management` | `facilities_management` | `asset_management` | `general_contractor` | `developer` | `broker` | `consultant` | `vendor` | `other`

**Touchpoint type keys** (touchpoint_types.key):
`pop_in` | `call` | `email` | `social`

**Outcome keys** (touchpoint_outcomes.key) — important ones:
- `connected_conversation` — spoke with someone
- `no_answer_voicemail` — no answer
- `gatekeeper` — couldn't get through
- `inspection_scheduled` — qualifies opportunity
- `bid_submitted` — milestone
- `won` | `lost` — final outcomes

**Engagement phase** (touchpoints.engagement_phase — needs migration):
`first_touch` | `follow_up` | `visibility`

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
3. `20260221060949_rpc_core_v1` — RPCs + seed data
4. `20260221113000_org_membership_lock_v1` — membership constraints
5. `20260222113000_align_schema_to_locked_v3_v1` — schema alignment
6. `20260222123000_rls_patch_locked_v3_v1` — RLS v3 (active)