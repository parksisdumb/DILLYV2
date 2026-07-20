-- account_onboarding_status_v1
--
-- Vendor onboarding / compliance status on accounts, separate from the existing
-- `status` (active/inactive) and from any pipeline stage. Tracks how far a
-- prospective vendor relationship has progressed through paperwork/compliance:
--   initial_touch → paperwork_started → paperwork_received → paperwork_finished → compliant
--
-- Reps AND managers can set it (via rpc_set_account_onboarding_status below),
-- because the accounts UPDATE RLS only lets a rep edit accounts they created —
-- the RPC is SECURITY DEFINER so any org member can advance onboarding status
-- without being able to edit the rest of the account.
--
-- NOTE: must be applied to prod manually (prod `db push` is blocked for the local
-- CLI account).

begin;

alter table if exists public.accounts
  add column if not exists onboarding_status text not null default 'initial_touch';

-- Enum guard (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'accounts_onboarding_status_check'
  ) then
    alter table public.accounts
      add constraint accounts_onboarding_status_check
      check (onboarding_status in (
        'initial_touch',
        'paperwork_started',
        'paperwork_received',
        'paperwork_finished',
        'compliant'
      ));
  end if;
end $$;

-- Any org member (rep, manager, admin) can set onboarding status on an org
-- account. SECURITY DEFINER bypasses the create-or-manager accounts UPDATE policy,
-- but scopes strictly to the caller's own org and only touches onboarding_status.
create or replace function public.rpc_set_account_onboarding_status(
  p_account_id uuid,
  p_status text
)
returns public.accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role text;
  v_account_org_id uuid;
  v_row public.accounts;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_status not in (
    'initial_touch', 'paperwork_started', 'paperwork_received',
    'paperwork_finished', 'compliant'
  ) then
    raise exception 'Invalid onboarding_status: %', p_status;
  end if;

  select m.org_id, m.role into v_org_id, v_role
  from public.rpc_get_my_org() m;

  select a.org_id into v_account_org_id
  from public.accounts a
  where a.id = p_account_id;

  if v_account_org_id is null then
    raise exception 'Account not found';
  end if;
  if v_account_org_id <> v_org_id then
    raise exception 'Account must belong to your organization';
  end if;

  update public.accounts
  set onboarding_status = p_status,
      updated_at = now()
  where id = p_account_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.rpc_set_account_onboarding_status(uuid, text) from public;
grant execute on function public.rpc_set_account_onboarding_status(uuid, text) to authenticated;

commit;
