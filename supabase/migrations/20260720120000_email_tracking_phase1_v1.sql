-- email_tracking_phase1_v1
--
-- Phase 1 of email tracking: per-user Gmail connect, metadata-only sync, and
-- auto-logged email touchpoints that feed follow-up signals.
--
--   * email_connections — one row per (user, provider). Holds ENCRYPTED OAuth
--     tokens (AES-256-GCM ciphertext produced server-side; the DB never sees
--     plaintext) plus the Gmail incremental cursor (history_id). Only the owning
--     user can read their row; all writes go through the service-role client.
--   * synced_emails — dedupe ledger + source for follow-up signals. One row per
--     Gmail message that matched an org contact. UNIQUE(user_id, gmail_message_id)
--     makes the sync idempotent.
--   * rpc_log_synced_email_touchpoint — the ONLY touchpoint-logging path that
--     works headless. Every existing touchpoint RPC derives org/user from
--     auth.uid() and is granted to `authenticated`, so a service-role Inngest job
--     (no JWT) can't call them. This SECURITY DEFINER function takes explicit
--     p_org_id + p_user_id, validates membership, and logs a VISIBILITY-ONLY
--     touchpoint (no score_events, no streaks, no KPI impact — background sync
--     must never inflate a rep's numbers), idempotent on gmail_message_id.
--
-- NOTE: must be applied to prod manually (prod `db push` is blocked for the local
-- CLI account).

begin;

-- ── email_connections ────────────────────────────────────────────────────────
create table if not exists public.email_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'gmail' check (provider in ('gmail', 'outlook')),
  email_address text,
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  history_id text,
  status text not null default 'active' check (status in ('active', 'error', 'revoked')),
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists email_connections_org_idx on public.email_connections (org_id);
create index if not exists email_connections_active_idx on public.email_connections (status) where status = 'active';

drop trigger if exists trg_email_connections_updated_at on public.email_connections;
create trigger trg_email_connections_updated_at
before update on public.email_connections
for each row execute function public.set_updated_at();

alter table public.email_connections enable row level security;

-- Owner can read their own connection row (ciphertext is useless without the
-- server-only key). All writes are service-role only (no authenticated policy).
drop policy if exists email_connections_select_own on public.email_connections;
create policy email_connections_select_own on public.email_connections
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ── synced_emails ────────────────────────────────────────────────────────────
create table if not exists public.synced_emails (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  gmail_message_id text not null,
  thread_id text,
  direction text not null check (direction in ('inbound', 'outbound')),
  from_email text,
  to_emails text[],
  subject text,
  message_ts timestamptz not null,
  matched_contact_id uuid references public.contacts(id) on delete set null,
  touchpoint_id uuid references public.touchpoints(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, gmail_message_id)
);

create index if not exists synced_emails_signal_idx
  on public.synced_emails (org_id, matched_contact_id, message_ts desc);
create index if not exists synced_emails_user_thread_idx
  on public.synced_emails (user_id, thread_id, message_ts);

alter table public.synced_emails enable row level security;

-- Owner can read their own synced emails (drives the follow-up signals UI).
drop policy if exists synced_emails_select_own on public.synced_emails;
create policy synced_emails_select_own on public.synced_emails
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ── rpc_log_synced_email_touchpoint ──────────────────────────────────────────
-- Headless, service-role-only. Idempotent on (user_id, gmail_message_id).
-- Returns the touchpoint id, or NULL when the message was already synced.
create or replace function public.rpc_log_synced_email_touchpoint(
  p_org_id uuid,
  p_user_id uuid,
  p_contact_id uuid,
  p_direction text,
  p_happened_at timestamptz,
  p_subject text,
  p_gmail_message_id text,
  p_thread_id text,
  p_from_email text,
  p_to_emails text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact_org_id uuid;
  v_account_id uuid;
  v_type_id uuid;
  v_synced_id uuid;
  v_touchpoint_id uuid;
  v_notes text := nullif(btrim(coalesce(p_subject, '')), '');
begin
  if p_org_id is null or p_user_id is null or p_contact_id is null then
    raise exception 'org, user, and contact are required';
  end if;
  if p_direction not in ('inbound', 'outbound') then
    raise exception 'direction must be inbound or outbound';
  end if;
  if nullif(btrim(coalesce(p_gmail_message_id, '')), '') is null then
    raise exception 'gmail_message_id is required';
  end if;

  -- Caller (the synced user) must belong to the org.
  if not exists (
    select 1 from public.org_users ou
    where ou.org_id = p_org_id and ou.user_id = p_user_id
  ) then
    raise exception 'user is not a member of the org';
  end if;

  -- Contact must belong to the org; adopt its account.
  select c.org_id, c.account_id
  into v_contact_org_id, v_account_id
  from public.contacts c
  where c.id = p_contact_id;

  if v_contact_org_id is null or v_contact_org_id <> p_org_id then
    raise exception 'contact is not in the org';
  end if;

  -- Resolve the email touchpoint type (org-specific preferred, else global).
  select tt.id into v_type_id
  from public.touchpoint_types tt
  where tt.key = 'email'
    and (tt.org_id = p_org_id or tt.org_id is null)
  order by (tt.org_id is not null) desc
  limit 1;

  if v_type_id is null then
    raise exception 'no email touchpoint type found';
  end if;

  -- Idempotency: claim the message. If it already exists, stop.
  insert into public.synced_emails (
    org_id, user_id, gmail_message_id, thread_id, direction,
    from_email, to_emails, subject, message_ts, matched_contact_id
  )
  values (
    p_org_id, p_user_id, p_gmail_message_id, p_thread_id, p_direction,
    p_from_email, p_to_emails, p_subject, coalesce(p_happened_at, now()), p_contact_id
  )
  on conflict (user_id, gmail_message_id) do nothing
  returning id into v_synced_id;

  if v_synced_id is null then
    return null; -- already synced
  end if;

  -- Visibility-only touchpoint: NO score_events, NO streaks, NO KPI.
  -- notes = subject; note falls back to a label when the subject is blank so the
  -- outreach-notes expectations elsewhere stay satisfied.
  insert into public.touchpoints (
    org_id, rep_user_id, account_id, contact_id,
    touchpoint_type_id, engagement_phase, direction,
    happened_at, notes, created_by
  )
  values (
    p_org_id, p_user_id, v_account_id, p_contact_id,
    v_type_id, 'follow_up', p_direction,
    coalesce(p_happened_at, now()),
    coalesce(v_notes, '(no subject)'), p_user_id
  )
  returning id into v_touchpoint_id;

  update public.synced_emails
  set touchpoint_id = v_touchpoint_id
  where id = v_synced_id;

  return v_touchpoint_id;
end;
$$;

revoke all on function public.rpc_log_synced_email_touchpoint(
  uuid, uuid, uuid, text, timestamptz, text, text, text, text, text[]
) from public;
grant execute on function public.rpc_log_synced_email_touchpoint(
  uuid, uuid, uuid, text, timestamptz, text, text, text, text, text[]
) to service_role;

commit;
