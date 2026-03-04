# Dilly v2

Commercial roofing Business Development OS. Execution engine for BD reps:
first-touch outreach, disciplined follow-up, territory-aware pipeline.

## Stack

- **Next.js 16** (App Router), **React 19**
- **Supabase** — PostgreSQL + Auth + Row Level Security
- **Tailwind CSS v4**
- **TypeScript** throughout

## Local Development

### Prerequisites

- Node.js 20+
- Supabase CLI: `npm install -g supabase`

### Setup

1. Clone the repo and install dependencies:
   ```bash
   npm install
   ```

2. Start Supabase locally:
   ```bash
   npx supabase start
   ```

3. Apply migrations and seed dev data:
   ```bash
   npx supabase db reset && npm run seed:dev
   ```

4. Copy the environment file:
   ```bash
   cp .env.local.example .env.local
   ```

5. Start the dev server:
   ```bash
   npm run dev
   ```

### Dev Credentials

- **Admin:** `admin@dilly.dev` / `devpassword123!`
- **Local app:** http://localhost:3000
- **Supabase Studio:** http://127.0.0.1:54323

## Project Structure

```
src/app/
  app/                  Authenticated app shell (AppShell layout)
    today/              Daily execution hub — Grow (outreach) + Advance (follow-up)
    accounts/           Account list + detail
    contacts/           Contact list + detail
    properties/         Property list + detail
    opportunities/      Pipeline view + deal detail
    manager/            Manager dashboard (manager/admin only)
    admin/              Team management + KPI targets
    setup/              Org onboarding (first-time setup)
  login/                Auth page (sign in / sign up)

supabase/
  migrations/           35 schema migrations — apply in order via `supabase db reset`
  tests/                pgTAP RLS policy tests
  seed.ts               Dev data seeder (accounts, contacts, properties, touchpoints)
```

## Key Architecture Decisions

- **Auth + RLS:** All queries are org-scoped via Supabase Row Level Security. Never add `org_id` filters to SELECT statements — RLS handles tenant isolation.
- **Server context:** Always use `requireServerOrgContext()` from `@/lib/supabase/server-org` in Server Components and Server Actions. For auth-only checks (no org required), use `getServerAuthOrgState()`.
- **Touchpoints are immutable:** Insert-only activity ledger. Never update or delete a touchpoint row.
- **Contacts require an account:** `contacts.account_id` is NOT NULL.
- **Opportunities require a property:** `opportunities.property_id` ties each deal to a building.
- **Next actions are contact-first:** `next_actions.contact_id` and `account_id` are both NOT NULL.
- **Write RPCs:** Use `rpc_log_outreach_touchpoint` for outreach (call/email/text/door_knock/site_visit) and `rpc_log_touchpoint` for non-outreach (inspection/bid/meeting). Never insert into `touchpoints` directly.

## Database Tests

Run RLS policy tests with pgTAP:

```bash
npx supabase db reset
npx supabase test db
```

Test coverage is in `supabase/tests/rls_core.test.sql`.

## Deployment

Deployment requires a production Supabase project and a hosting provider (Vercel or equivalent). See the deployment guide — this repo is currently local-only.
