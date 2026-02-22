-- Make rpc_bootstrap_org idempotent against org_users and safe for repeated calls.
-- Behavior:
-- 1) If user already exists in org_users, return that org_id and do nothing else.
-- 2) Otherwise create org + ensure roles, then upsert org_users on (user_id).
-- 3) If a conflict occurs, return existing org_id for that user.
-- 4) Keep memberships in sync for current RLS/RPC compatibility.

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

  -- Ensure roles for the newly created org.
  insert into public.roles (org_id, key, name, created_by)
  values
    (v_new_org_id, 'admin', 'Admin', v_user_id),
    (v_new_org_id, 'manager', 'Manager', v_user_id),
    (v_new_org_id, 'rep', 'Rep', v_user_id)
  on conflict (org_id, key) where org_id is not null do nothing;

  -- Conflict-safe user->org assignment.
  -- DO UPDATE is intentionally a no-op to return the existing org_id on conflict.
  insert into public.org_users (org_id, user_id, role)
  values (v_new_org_id, v_user_id, 'admin')
  on conflict (user_id) do update
    set org_id = public.org_users.org_id,
        role = public.org_users.role
  returning org_id into v_org_id;

  -- If we lost a race and got a different effective org_id, remove the new orphan org.
  if v_org_id <> v_new_org_id then
    delete from public.orgs o
    where o.id = v_new_org_id
      and not exists (select 1 from public.org_users ou where ou.org_id = o.id)
      and not exists (select 1 from public.memberships m where m.org_id = o.id);
  end if;

  -- Ensure effective org has default roles.
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

  -- Bridge for current app/RLS which still reads memberships.
  insert into public.memberships (org_id, user_id, role_id, created_by)
  values (v_org_id, v_user_id, v_admin_role_id, v_user_id)
  on conflict do nothing;

  return v_org_id;
end;
$$;

revoke all on function public.rpc_bootstrap_org(text) from public;
grant execute on function public.rpc_bootstrap_org(text) to authenticated;
