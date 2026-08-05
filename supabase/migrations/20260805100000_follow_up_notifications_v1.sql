-- Follow-up alerting system, phase 1 (email). The push layer over the pull-based
-- Advance queue. Three tables:
--
--   * notification_preferences — per-user opt-out for the morning digest.
--     Default ON (absent row = opted in). Self-service in My Settings. NOTE: opting
--     out only silences the REP's own digest — overdue items still escalate to the
--     manager digest regardless (follow-up is a protected function).
--   * digest_sends — idempotency + per-user send ledger. UNIQUE(user_id,
--     digest_type,send_date) is the once-per-day claim so a cron re-run never
--     double-sends. Alerts derive LIVE from next_actions state (resolution-only
--     exit) — this table records only that a send happened, never the alert state.
--   * cron_runs — last-run status for the notification cron so a silent failure is
--     visible on the admin console (the benchmarks-cron lesson: failing silently is
--     the exact sin this system exists to prevent).

-- ── notification_preferences ─────────────────────────────────────────────────
create table if not exists public.notification_preferences (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  follow_up_digest boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

alter table public.notification_preferences enable row level security;

-- A user reads and writes only their own preference row (within an org they belong to).
drop policy if exists notification_preferences_select_own on public.notification_preferences;
create policy notification_preferences_select_own on public.notification_preferences
  for select to authenticated
  using (user_id = (select auth.uid()) and public.rls_is_org_member(org_id));

drop policy if exists notification_preferences_insert_own on public.notification_preferences;
create policy notification_preferences_insert_own on public.notification_preferences
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.rls_is_org_member(org_id));

drop policy if exists notification_preferences_update_own on public.notification_preferences;
create policy notification_preferences_update_own on public.notification_preferences
  for update to authenticated
  using (user_id = (select auth.uid()) and public.rls_is_org_member(org_id))
  with check (user_id = (select auth.uid()) and public.rls_is_org_member(org_id));

-- ── digest_sends ─────────────────────────────────────────────────────────────
create table if not exists public.digest_sends (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  digest_type text not null check (digest_type in ('rep', 'manager')),
  send_date date not null,
  status text not null default 'sent' check (status in ('claimed', 'sent', 'skipped', 'error')),
  item_counts jsonb,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  unique (user_id, digest_type, send_date)
);

create index if not exists digest_sends_recent_idx on public.digest_sends (send_date desc, org_id);

-- Service-role only (cron writes, admin console reads). RLS on + no policy = deny-all
-- for anon/authenticated; the service role bypasses RLS.
alter table public.digest_sends enable row level security;

-- ── cron_runs ────────────────────────────────────────────────────────────────
-- Generic last-run ledger for scheduled jobs. Keyed by `job` so other crons can
-- reuse it later. `status='running'` that never finalizes = a crash (visible as
-- stuck on the admin console).
create table if not exists public.cron_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  status text not null check (status in ('running', 'ok', 'error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb,
  error text
);

create index if not exists cron_runs_job_recent_idx on public.cron_runs (job, started_at desc);

-- Service-role only (cron writes, admin console reads).
alter table public.cron_runs enable row level security;
