begin;

-- =========================================================
-- org_users_name_email_v1
-- Add full_name and email to org_users, auto-populated
-- from auth.users / profiles on insert and kept in sync.
-- =========================================================

-- 1. Add columns
alter table public.org_users
  add column if not exists full_name text,
  add column if not exists email text;

-- 2. Backfill from auth.users + profiles for existing rows
update public.org_users ou
set
  full_name = coalesce(p.full_name, u.email),
  email = u.email
from auth.users u
left join public.profiles p on p.user_id = u.id
where ou.user_id = u.id
  and (ou.full_name is null or ou.email is null);

-- 3. Trigger function: auto-populate on org_users INSERT
--    Reads from auth.users + profiles at insert time.
create or replace function public.trg_org_users_populate_name_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_full_name text;
begin
  select u.email, coalesce(p.full_name, u.email)
  into v_email, v_full_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = new.user_id;

  new.email := coalesce(new.email, v_email);
  new.full_name := coalesce(new.full_name, v_full_name);

  return new;
end;
$$;

drop trigger if exists trg_org_users_populate_name_email on public.org_users;
create trigger trg_org_users_populate_name_email
before insert on public.org_users
for each row execute function public.trg_org_users_populate_name_email();

-- 4. Trigger function: sync name from profiles when profile is updated
create or replace function public.trg_profiles_sync_org_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.org_users
  set full_name = new.full_name
  where user_id = new.user_id
    and (full_name is distinct from new.full_name);
  return new;
end;
$$;

drop trigger if exists trg_profiles_sync_org_users on public.profiles;
create trigger trg_profiles_sync_org_users
after update of full_name on public.profiles
for each row execute function public.trg_profiles_sync_org_users();

commit;
