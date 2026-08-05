-- demo_requests: inbound "Get a demo" submissions from the public landing page (/).
--
-- The landing form is PUBLIC (logged-out). It writes via a Next.js server action
-- that uses the service-role admin client (createAdminClient) — the browser never
-- gets write access. RLS is enabled with NO policies, so anon/authenticated roles
-- have zero access; only the service-role (which bypasses RLS) can read/write.
-- Platform admins read these out-of-band (service role / SQL editor).

create table if not exists public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  email text not null,
  source text not null default 'landing',
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists demo_requests_created_at_idx on public.demo_requests (created_at desc);

alter table public.demo_requests enable row level security;
-- Intentionally no policies: RLS-enabled + no policy = deny-all for anon/authenticated.
-- Writes happen only through the service-role server action.
