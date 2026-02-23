begin;

-- =========================================================
-- org_invites_v1
-- Manager/admin invite flow for org membership assignment.
-- =========================================================

create table if not exists public.org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  email text not null,
  role text not null check (role in ('rep', 'manager', 'admin')),
  token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  note text
);

alter table if exists public.org_invites
  add column if not exists org_id uuid;
alter table if exists public.org_invites
  add column if not exists email text;
alter table if exists public.org_invites
  add column if not exists role text;
alter table if exists public.org_invites
  add column if not exists token uuid;
alter table if exists public.org_invites
  add column if not exists created_at timestamptz;
alter table if exists public.org_invites
  add column if not exists created_by uuid;
alter table if exists public.org_invites
  add column if not exists expires_at timestamptz;
alter table if exists public.org_invites
  add column if not exists accepted_at timestamptz;
alter table if exists public.org_invites
  add column if not exists accepted_by uuid;
alter table if exists public.org_invites
  add column if not exists revoked_at timestamptz;
alter table if exists public.org_invites
  add column if not exists revoked_by uuid;
alter table if exists public.org_invites
  add column if not exists note text;

do $$
begin
  if to_regclass('public.org_invites') is null then
    return;
  end if;

  update public.org_invites
  set token = gen_random_uuid()
  where token is null;

  update public.org_invites
  set created_at = now()
  where created_at is null;

  update public.org_invites
  set expires_at = now() + interval '7 days'
  where expires_at is null;

  alter table public.org_invites
    alter column token set default gen_random_uuid();
  alter table public.org_invites
    alter column created_at set default now();
  alter table public.org_invites
    alter column expires_at set default (now() + interval '7 days');

  alter table public.org_invites
    alter column org_id set not null;
  alter table public.org_invites
    alter column email set not null;
  alter table public.org_invites
    alter column role set not null;
  alter table public.org_invites
    alter column token set not null;
  alter table public.org_invites
    alter column created_at set not null;
  alter table public.org_invites
    alter column expires_at set not null;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.org_invites'::regclass
      and c.conname = 'org_invites_org_id_fkey'
  ) then
    alter table public.org_invites
      add constraint org_invites_org_id_fkey
      foreign key (org_id) references public.orgs(id) on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.org_invites'::regclass
      and c.conname = 'org_invites_created_by_fkey'
  ) then
    alter table public.org_invites
      add constraint org_invites_created_by_fkey
      foreign key (created_by) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.org_invites'::regclass
      and c.conname = 'org_invites_accepted_by_fkey'
  ) then
    alter table public.org_invites
      add constraint org_invites_accepted_by_fkey
      foreign key (accepted_by) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.org_invites'::regclass
      and c.conname = 'org_invites_revoked_by_fkey'
  ) then
    alter table public.org_invites
      add constraint org_invites_revoked_by_fkey
      foreign key (revoked_by) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.org_invites'::regclass
      and c.conname = 'org_invites_role_check'
  ) then
    alter table public.org_invites
      add constraint org_invites_role_check
      check (role in ('rep', 'manager', 'admin'));
  end if;
end $$;

create unique index if not exists org_invites_token_unique
  on public.org_invites (token);

create index if not exists org_invites_org_id_idx
  on public.org_invites (org_id);

create index if not exists org_invites_email_lower_idx
  on public.org_invites ((lower(email)));

create index if not exists org_invites_pending_idx
  on public.org_invites (org_id, created_at desc)
  where accepted_at is null and revoked_at is null;

alter table if exists public.org_invites enable row level security;

drop policy if exists org_invites_select_manager_admin on public.org_invites;
create policy org_invites_select_manager_admin
on public.org_invites
for select
to authenticated
using (public.is_org_manager_or_admin_v3(org_id));

-- -------------------------
-- RPC: invite user
-- -------------------------
create or replace function public.rpc_invite_user(
  p_email text,
  p_role text default 'rep',
  p_expires_in_days int default 7,
  p_note text default null
)
returns public.org_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_inviter_role text;
  v_email text := lower(trim(p_email));
  v_role text := lower(trim(p_role));
  v_existing public.org_invites;
  v_existing_user_org uuid;
  v_result public.org_invites;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if v_email is null or v_email = '' or position('@' in v_email) = 0 then
    raise exception 'Valid email required';
  end if;

  if v_role not in ('rep', 'manager', 'admin') then
    raise exception 'Invalid role: %', v_role;
  end if;

  select ou.org_id, ou.role
  into v_org_id, v_inviter_role
  from public.org_users ou
  where ou.user_id = v_uid
  limit 1;

  if v_org_id is null then
    raise exception 'User is not assigned to an organization';
  end if;

  if v_inviter_role not in ('manager', 'admin') then
    raise exception 'Manager or admin role required';
  end if;

  if v_inviter_role = 'manager' and v_role <> 'rep' then
    raise exception 'Managers can only invite reps';
  end if;

  select ou.org_id
  into v_existing_user_org
  from auth.users u
  join public.org_users ou on ou.user_id = u.id
  where lower(u.email) = v_email
  limit 1;

  if v_existing_user_org is not null and v_existing_user_org <> v_org_id then
    raise exception 'User already belongs to another organization';
  end if;

  if v_existing_user_org = v_org_id then
    raise exception 'User is already a member of this organization';
  end if;

  select *
  into v_existing
  from public.org_invites oi
  where oi.org_id = v_org_id
    and lower(oi.email) = v_email
    and oi.accepted_at is null
    and oi.revoked_at is null
    and oi.expires_at > now()
  order by oi.created_at desc
  limit 1;

  if v_existing.id is not null then
    return v_existing;
  end if;

  insert into public.org_invites (
    org_id, email, role, created_by, expires_at, note
  )
  values (
    v_org_id,
    v_email,
    v_role,
    v_uid,
    now() + make_interval(days => greatest(1, p_expires_in_days)),
    p_note
  )
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.rpc_invite_user(text, text, int, text) from public;
grant execute on function public.rpc_invite_user(text, text, int, text) to authenticated;

-- -------------------------
-- RPC: accept invite
-- -------------------------
create or replace function public.rpc_accept_invite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_user_email text;
  v_invite public.org_invites;
  v_existing_org uuid;
  v_role_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select lower(u.email)
  into v_user_email
  from auth.users u
  where u.id = v_uid
  limit 1;

  if v_user_email is null then
    raise exception 'Authenticated user email not found';
  end if;

  select *
  into v_invite
  from public.org_invites oi
  where oi.token = p_token
  limit 1;

  if v_invite.id is null then
    raise exception 'Invite not found';
  end if;

  if v_invite.revoked_at is not null then
    raise exception 'Invite revoked';
  end if;

  if v_invite.expires_at < now() then
    raise exception 'Invite expired';
  end if;

  if lower(v_invite.email) <> v_user_email then
    raise exception 'Invite email does not match signed-in user';
  end if;

  if v_invite.accepted_at is not null then
    if v_invite.accepted_by = v_uid then
      return v_invite.org_id;
    end if;
    raise exception 'Invite already accepted';
  end if;

  select ou.org_id
  into v_existing_org
  from public.org_users ou
  where ou.user_id = v_uid
  limit 1;

  if v_existing_org is not null and v_existing_org <> v_invite.org_id then
    raise exception 'User already belongs to another organization';
  end if;

  if v_existing_org is null then
    insert into public.org_users (org_id, user_id, role)
    values (v_invite.org_id, v_uid, v_invite.role)
    on conflict (user_id) do nothing;

    select ou.org_id
    into v_existing_org
    from public.org_users ou
    where ou.user_id = v_uid
    limit 1;
  end if;

  if v_existing_org <> v_invite.org_id then
    raise exception 'Unable to assign user to invite org';
  end if;

  select r.id
  into v_role_id
  from public.roles r
  where r.org_id = v_invite.org_id
    and r.key = v_invite.role
  limit 1;

  if v_role_id is null then
    insert into public.roles (org_id, key, name, created_by)
    values (v_invite.org_id, v_invite.role, initcap(v_invite.role), coalesce(v_invite.created_by, v_uid))
    on conflict (org_id, key) where org_id is not null do nothing;

    select r.id
    into v_role_id
    from public.roles r
    where r.org_id = v_invite.org_id
      and r.key = v_invite.role
    limit 1;
  end if;

  if to_regclass('public.memberships') is not null and v_role_id is not null then
    insert into public.memberships (org_id, user_id, role_id, created_by)
    values (v_invite.org_id, v_uid, v_role_id, coalesce(v_invite.created_by, v_uid))
    on conflict do nothing;
  end if;

  update public.org_invites
  set accepted_at = coalesce(accepted_at, now()),
      accepted_by = coalesce(accepted_by, v_uid)
  where id = v_invite.id;

  return v_invite.org_id;
end;
$$;

revoke all on function public.rpc_accept_invite(uuid) from public;
grant execute on function public.rpc_accept_invite(uuid) to authenticated;

commit;
