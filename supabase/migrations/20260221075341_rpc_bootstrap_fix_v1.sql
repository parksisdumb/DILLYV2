-- Fix rpc_bootstrap_org: avoid multi-row RETURNING into a scalar

create or replace function public.rpc_bootstrap_org(p_org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_admin_role_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- Create org
  insert into public.orgs (name, created_by)
  values (p_org_name, auth.uid())
  returning id into v_org_id;

  -- Create roles (no RETURNING here)
  insert into public.roles (org_id, key, name, created_by)
  values
    (v_org_id, 'admin', 'Admin', auth.uid()),
    (v_org_id, 'manager', 'Manager', auth.uid()),
    (v_org_id, 'rep', 'Rep', auth.uid())
  on conflict (org_id, key) where org_id is not null do nothing;

  -- Fetch admin role id safely (single row)
  select id
  into v_admin_role_id
  from public.roles
  where org_id = v_org_id and key = 'admin'
  limit 1;

  -- Create membership for current user
  insert into public.memberships (org_id, user_id, role_id, created_by)
  values (v_org_id, auth.uid(), v_admin_role_id, auth.uid())
  on conflict (org_id, user_id) do nothing;

  return v_org_id;
end;
$$;

revoke all on function public.rpc_bootstrap_org(text) from public;
grant execute on function public.rpc_bootstrap_org(text) to authenticated;
