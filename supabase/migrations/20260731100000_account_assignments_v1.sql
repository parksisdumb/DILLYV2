-- Account → rep assignment: an operational DISPATCH label, mirroring
-- property_assignments. It is PERMISSION-NEUTRAL — being assigned to an account
-- grants NO edit/visibility rights (the same lesson as migration 72, which
-- decoupled properties RLS from property_assignments). Nothing in accounts RLS
-- references this table; it exists purely so managers can route work and reps can
-- filter "my accounts". Org-visible (any member can read who's assigned);
-- manager/admin write only.

create table if not exists public.account_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  unique (account_id, user_id)
);

create index if not exists account_assignments_org_idx on public.account_assignments (org_id);
create index if not exists account_assignments_user_idx on public.account_assignments (user_id);
create index if not exists account_assignments_account_idx on public.account_assignments (account_id);

alter table public.account_assignments enable row level security;

-- Org-read: any org member can see assignments (operational visibility).
drop policy if exists account_assignments_select_org_member on public.account_assignments;
create policy account_assignments_select_org_member
on public.account_assignments
for select
to authenticated
using (public.rls_is_org_member(org_id));

-- Manager/admin write only (insert + delete; assignments are role-free, so there
-- is nothing to update — assign = insert, unassign = delete).
drop policy if exists account_assignments_insert_manager on public.account_assignments;
create policy account_assignments_insert_manager
on public.account_assignments
for insert
to authenticated
with check (public.rls_is_manager_admin(org_id));

drop policy if exists account_assignments_delete_manager on public.account_assignments;
create policy account_assignments_delete_manager
on public.account_assignments
for delete
to authenticated
using (public.rls_is_manager_admin(org_id));

notify pgrst, 'reload schema';
