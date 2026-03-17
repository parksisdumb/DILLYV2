begin;

-- =========================================================
-- agent_runs_v1
-- Prospecting agent infrastructure.
-- Tables: agent_runs
-- Columns added: prospects.agent_metadata
-- =========================================================

-- -------------------------
-- 1. agent_runs
-- -------------------------
create table if not exists public.agent_runs (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.orgs(id) on delete cascade,
  run_type                text not null default 'prospecting'
                            check (run_type in ('prospecting')),
  status                  text not null default 'running'
                            check (status in ('running', 'completed', 'failed')),
  prospects_found         int not null default 0,
  prospects_added         int not null default 0,
  prospects_skipped_dedup int not null default 0,
  source_breakdown        jsonb not null default '{}'::jsonb,
  started_at              timestamptz not null default now(),
  completed_at            timestamptz,
  error_message           text,
  created_at              timestamptz not null default now()
);

create index if not exists agent_runs_org_idx on public.agent_runs (org_id);
create index if not exists agent_runs_org_status_idx on public.agent_runs (org_id, status);

-- -------------------------
-- 2. Add agent_metadata to prospects
-- -------------------------
alter table public.prospects
  add column if not exists agent_metadata jsonb;

-- -------------------------
-- 3. RLS for agent_runs
-- -------------------------
alter table public.agent_runs enable row level security;

drop policy if exists agent_runs_select_member on public.agent_runs;
create policy agent_runs_select_member
on public.agent_runs for select to authenticated
using (public.rls_is_org_member(org_id));

drop policy if exists agent_runs_insert_manager on public.agent_runs;
create policy agent_runs_insert_manager
on public.agent_runs for insert to authenticated
with check (public.rls_is_manager_admin(org_id));

drop policy if exists agent_runs_update_manager on public.agent_runs;
create policy agent_runs_update_manager
on public.agent_runs for update to authenticated
using (public.rls_is_manager_admin(org_id))
with check (public.rls_is_manager_admin(org_id));

drop policy if exists agent_runs_delete_manager on public.agent_runs;
create policy agent_runs_delete_manager
on public.agent_runs for delete to authenticated
using (public.rls_is_manager_admin(org_id));

commit;
