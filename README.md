This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Local Dev User Seeding

After resetting local Supabase, seed deterministic dev users:

1. `npx supabase db reset`
2. `npm run seed:dev`
3. Log in with `admin@dilly.dev` / `devpassword123!`

Environment required by the seeding script:

- `SUPABASE_URL` (defaults to `http://127.0.0.1:54321`)
- `SUPABASE_SERVICE_ROLE_KEY` (or `SERVICE_ROLE_KEY` from `supabase status -o env`)

## RLS pgTAP Tests

Run database policy tests with pgTAP:

1. `npx supabase db reset`
2. `npx supabase test db`

Current core test coverage is in:

- `supabase/tests/rls_core.test.sql`

It verifies:

- Rep org-wide `SELECT` access for accounts/contacts/properties.
- Rep update restrictions for unassigned/not-created records.
- Rep update allowance for assigned property.
- Manager update allowance for unassigned property.
