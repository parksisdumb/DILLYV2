-- Reviewed snippet: idempotent bootstrap using org_users.
-- Note: production rollout should use migration:
-- supabase/migrations/20260221121500_rpc_bootstrap_org_users_idempotent_v1.sql

create or replace function public.rpc_bootstrap_org(p_org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_existing_org_id uuid;
  v_new_org_id uuid;
  v_org_id uuid;
  v_admin_role_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Fast path: user already assigned to an org.
  select ou.org_id
  into v_existing_org_id
  from public.org_users ou
  where ou.user_id = v_user_id
  limit 1;

  if v_existing_org_id is not null then
    return v_existing_org_id;
  end if;

  -- Serialize bootstrap per user to reduce race-created duplicate orgs.
  perform pg_advisory_xact_lock(hashtext('rpc_bootstrap_org'), hashtext(v_user_id::text));

  -- Re-check under lock.
  select ou.org_id
  into v_existing_org_id
  from public.org_users ou
  where ou.user_id = v_user_id
  limit 1;

  if v_existing_org_id is not null then
    return v_existing_org_id;
  end if;

  insert into public.orgs (name, created_by)
  values (p_org_name, v_user_id)
  returning id into v_new_org_id;

  insert into public.roles (org_id, key, name, created_by)
  values
    (v_new_org_id, 'admin', 'Admin', v_user_id),
    (v_new_org_id, 'manager', 'Manager', v_user_id),
    (v_new_org_id, 'rep', 'Rep', v_user_id)
  on conflict (org_id, key) where org_id is not null do nothing;

  insert into public.org_users (org_id, user_id, role)
  values (v_new_org_id, v_user_id, 'admin')
  on conflict (user_id) do update
    set org_id = public.org_users.org_id,
        role = public.org_users.role
  returning org_id into v_org_id;

  if v_org_id <> v_new_org_id then
    delete from public.orgs o
    where o.id = v_new_org_id
      and not exists (select 1 from public.org_users ou where ou.org_id = o.id)
      and not exists (select 1 from public.memberships m where m.org_id = o.id);
  end if;

  insert into public.roles (org_id, key, name, created_by)
  values
    (v_org_id, 'admin', 'Admin', v_user_id),
    (v_org_id, 'manager', 'Manager', v_user_id),
    (v_org_id, 'rep', 'Rep', v_user_id)
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

  insert into public.memberships (org_id, user_id, role_id, created_by)
  values (v_org_id, v_user_id, v_admin_role_id, v_user_id)
  on conflict do nothing;

  return v_org_id;
end;
$$;

revoke all on function public.rpc_bootstrap_org(text) from public;
grant execute on function public.rpc_bootstrap_org(text) to authenticated;
