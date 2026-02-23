begin;

-- =========================================================
-- rpc_provision_org_owner_v1
-- Service-only org provisioning for initial tenant setup.
-- =========================================================

create or replace function public.rpc_provision_org_owner(
  p_org_name text,
  p_owner_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_new_org_id uuid;
  v_admin_role_id uuid;
begin
  if p_owner_user_id is null then
    raise exception 'Owner user id is required';
  end if;

  if p_org_name is null or btrim(p_org_name) = '' then
    raise exception 'Organization name is required';
  end if;

  if not exists (
    select 1 from auth.users u where u.id = p_owner_user_id
  ) then
    raise exception 'Owner user not found';
  end if;

  -- Fast path: owner already assigned to an org.
  select ou.org_id
  into v_org_id
  from public.org_users ou
  where ou.user_id = p_owner_user_id
  limit 1;

  if v_org_id is not null then
    return v_org_id;
  end if;

  -- Serialize provisioning per user to avoid duplicate org creation races.
  perform pg_advisory_xact_lock(
    hashtext('rpc_provision_org_owner'),
    hashtext(p_owner_user_id::text)
  );

  -- Recheck under lock.
  select ou.org_id
  into v_org_id
  from public.org_users ou
  where ou.user_id = p_owner_user_id
  limit 1;

  if v_org_id is not null then
    return v_org_id;
  end if;

  insert into public.orgs (name, created_by)
  values (btrim(p_org_name), p_owner_user_id)
  returning id into v_new_org_id;

  insert into public.roles (org_id, key, name, created_by)
  values
    (v_new_org_id, 'admin', 'Admin', p_owner_user_id),
    (v_new_org_id, 'manager', 'Manager', p_owner_user_id),
    (v_new_org_id, 'rep', 'Rep', p_owner_user_id)
  on conflict (org_id, key) where org_id is not null do nothing;

  insert into public.org_users (org_id, user_id, role)
  values (v_new_org_id, p_owner_user_id, 'admin')
  on conflict (user_id) do update
    set org_id = public.org_users.org_id,
        role = public.org_users.role
  returning org_id into v_org_id;

  if v_org_id <> v_new_org_id then
    delete from public.orgs o
    where o.id = v_new_org_id
      and not exists (select 1 from public.org_users ou where ou.org_id = o.id)
      and (
        to_regclass('public.memberships') is null
        or not exists (select 1 from public.memberships m where m.org_id = o.id)
      );
  end if;

  -- Ensure role rows exist for the owner org in case of contention reuse.
  insert into public.roles (org_id, key, name, created_by)
  values
    (v_org_id, 'admin', 'Admin', p_owner_user_id),
    (v_org_id, 'manager', 'Manager', p_owner_user_id),
    (v_org_id, 'rep', 'Rep', p_owner_user_id)
  on conflict (org_id, key) where org_id is not null do nothing;

  select r.id
  into v_admin_role_id
  from public.roles r
  where r.org_id = v_org_id
    and r.key = 'admin'
  limit 1;

  if v_admin_role_id is null then
    raise exception 'Missing admin role for org %', v_org_id;
  end if;

  if to_regclass('public.memberships') is not null then
    insert into public.memberships (org_id, user_id, role_id, created_by)
    values (v_org_id, p_owner_user_id, v_admin_role_id, p_owner_user_id)
    on conflict do nothing;
  end if;

  return v_org_id;
end;
$$;

revoke all on function public.rpc_provision_org_owner(text, uuid) from public;
revoke execute on function public.rpc_provision_org_owner(text, uuid) from authenticated;
grant execute on function public.rpc_provision_org_owner(text, uuid) to service_role;

commit;
