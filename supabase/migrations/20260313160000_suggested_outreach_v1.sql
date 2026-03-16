-- Session 16: Suggested Outreach Queue
-- Table: suggested_outreach — manager-curated prospect queue for reps

begin;

create table public.suggested_outreach (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  territory_id  uuid references public.territories(id) on delete set null,
  user_id       uuid not null references auth.users(id) on delete cascade,
  prospect_id   uuid not null references public.prospects(id) on delete cascade,
  rank_score    int not null default 50 check (rank_score >= 0 and rank_score <= 100),
  reason_codes  jsonb not null default '[]'::jsonb,
  status        text not null default 'new'
                  check (status in ('new', 'accepted', 'dismissed', 'converted')),
  assigned_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- No duplicate assignments for same rep + prospect
create unique index suggested_outreach_dedupe_idx
  on public.suggested_outreach (org_id, user_id, prospect_id);

-- Rep queue queries
create index suggested_outreach_user_status_idx
  on public.suggested_outreach (user_id, status);

create index suggested_outreach_org_idx
  on public.suggested_outreach (org_id);

create index suggested_outreach_prospect_idx
  on public.suggested_outreach (prospect_id);

-- Auto-update updated_at
create trigger set_updated_at
  before update on public.suggested_outreach
  for each row execute function public.set_updated_at();

-- RLS
alter table public.suggested_outreach enable row level security;

-- Org members can read all suggestions (managers need visibility)
create policy suggested_outreach_select_member on public.suggested_outreach
  for select to authenticated
  using (public.rls_is_org_member(org_id));

-- Managers/admins can insert (assign prospects to reps)
create policy suggested_outreach_insert_manager on public.suggested_outreach
  for insert to authenticated
  with check (public.rls_is_manager_admin(org_id));

-- Managers/admins can update any suggestion
create policy suggested_outreach_update_manager on public.suggested_outreach
  for update to authenticated
  using (public.rls_is_manager_admin(org_id))
  with check (public.rls_is_manager_admin(org_id));

-- Reps can update their own suggestions (accept/dismiss)
create policy suggested_outreach_update_own on public.suggested_outreach
  for update to authenticated
  using (user_id = auth.uid());

-- Managers/admins can delete
create policy suggested_outreach_delete_manager on public.suggested_outreach
  for delete to authenticated
  using (public.rls_is_manager_admin(org_id));

commit;
