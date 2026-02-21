-- Make rpc_bootstrap_org idempotent for local/dev retries.
-- Behavior:
-- 1) If the current user already has any membership, return that org_id.
-- 2) Otherwise, get-or-create an org by (name, created_by = auth.uid()).
-- 3) Ensure org roles exist, then ensure admin membership exists.

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

  -- Idempotent fast path: if user already belongs to an org, return it.
  select m.org_id
  into v_org_id
  from public.memberships m
  where m.user_id = auth.uid()
  order by m.created_at asc
  limit 1;

  if v_org_id is not null then
    return v_org_id;
  end if;

  -- Try to reuse an org with the same name previously created by this user.
  select o.id
  into v_org_id
  from public.orgs o
  where o.name = p_org_name
    and o.created_by = auth.uid()
  order by o.created_at asc
  limit 1;

  -- Otherwise create a new org.
  if v_org_id is null then
    insert into public.orgs (name, created_by)
    values (p_org_name, auth.uid())
    returning id into v_org_id;
  end if;

  -- Ensure org-scoped roles exist.
  insert into public.roles (org_id, key, name, created_by)
  values
    (v_org_id, 'admin', 'Admin', auth.uid()),
    (v_org_id, 'manager', 'Manager', auth.uid()),
    (v_org_id, 'rep', 'Rep', auth.uid())
  on conflict (org_id, key) where org_id is not null do nothing;

  select r.id
  into v_admin_role_id
  from public.roles r
  where r.org_id = v_org_id
    and r.key = 'admin'
  limit 1;

  insert into public.memberships (org_id, user_id, role_id, created_by)
  values (v_org_id, auth.uid(), v_admin_role_id, auth.uid())
  on conflict (org_id, user_id) do nothing;

  return v_org_id;
end;
$$;

revoke all on function public.rpc_bootstrap_org(text) from public;
grant execute on function public.rpc_bootstrap_org(text) to authenticated;
