begin;

-- =========================================================
-- align_schema_to_locked_v3_v1
-- Goal: align current schema to locked v3 rules without breaking v2 app flow.
-- =========================================================

-- 1) Soft-delete columns (keep existing status/is_active columns as-is)
alter table if exists public.accounts
  add column if not exists deleted_at timestamptz;

alter table if exists public.contacts
  add column if not exists deleted_at timestamptz;

alter table if exists public.properties
  add column if not exists deleted_at timestamptz;

alter table if exists public.opportunities
  add column if not exists deleted_at timestamptz;

-- 2) Contacts alignment (keep full_name for compatibility)
alter table if exists public.contacts
  add column if not exists first_name text;

alter table if exists public.contacts
  add column if not exists last_name text;

alter table if exists public.contacts
  add column if not exists decision_role text;

do $$
begin
  if to_regclass('public.contacts') is null then
    return;
  end if;

  alter table public.contacts
    add column if not exists priority_score numeric;

  update public.contacts
  set priority_score = 0
  where priority_score is null;

  alter table public.contacts
    alter column priority_score set default 0;

  alter table public.contacts
    alter column priority_score set not null;
end $$;

-- 3) Property-Contact join table
create table if not exists public.property_contacts (
  property_id uuid not null references public.properties(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  relationship_type text,
  priority_rank int not null default 0,
  is_primary boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (property_id, contact_id)
);

-- If table already existed in an older shape, fill in any missing columns.
alter table if exists public.property_contacts
  add column if not exists relationship_type text;
alter table if exists public.property_contacts
  add column if not exists priority_rank int;
alter table if exists public.property_contacts
  add column if not exists is_primary boolean;
alter table if exists public.property_contacts
  add column if not exists active boolean;
alter table if exists public.property_contacts
  add column if not exists created_at timestamptz;
alter table if exists public.property_contacts
  add column if not exists updated_at timestamptz;
alter table if exists public.property_contacts
  add column if not exists created_by uuid;

do $$
begin
  if to_regclass('public.property_contacts') is null then
    return;
  end if;

  update public.property_contacts
  set priority_rank = 0
  where priority_rank is null;

  update public.property_contacts
  set is_primary = false
  where is_primary is null;

  update public.property_contacts
  set active = true
  where active is null;

  update public.property_contacts
  set created_at = now()
  where created_at is null;

  update public.property_contacts
  set updated_at = now()
  where updated_at is null;

  alter table public.property_contacts
    alter column priority_rank set default 0;
  alter table public.property_contacts
    alter column is_primary set default false;
  alter table public.property_contacts
    alter column active set default true;
  alter table public.property_contacts
    alter column created_at set default now();
  alter table public.property_contacts
    alter column updated_at set default now();

  alter table public.property_contacts
    alter column priority_rank set not null;
  alter table public.property_contacts
    alter column is_primary set not null;
  alter table public.property_contacts
    alter column active set not null;
  alter table public.property_contacts
    alter column created_at set not null;
  alter table public.property_contacts
    alter column updated_at set not null;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.property_contacts'::regclass
      and c.contype = 'p'
  ) then
    alter table public.property_contacts
      add constraint property_contacts_pkey primary key (property_id, contact_id);
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.property_contacts'::regclass
      and c.conname = 'property_contacts_created_by_fkey'
  ) then
    alter table public.property_contacts
      add constraint property_contacts_created_by_fkey
      foreign key (created_by) references auth.users(id) on delete set null;
  end if;
end $$;

drop trigger if exists trg_property_contacts_updated_at on public.property_contacts;
create trigger trg_property_contacts_updated_at
before update on public.property_contacts
for each row execute function public.set_updated_at();

create index if not exists property_contacts_property_id_idx
  on public.property_contacts (property_id);

create index if not exists property_contacts_contact_id_idx
  on public.property_contacts (contact_id);

-- 4) Opportunities alignment
do $$
begin
  if to_regclass('public.opportunities') is null then
    return;
  end if;

  alter table public.opportunities
    alter column property_id drop not null;

  alter table public.opportunities
    add column if not exists account_id uuid;

  alter table public.opportunities
    add column if not exists primary_contact_id uuid;
end $$;

do $$
declare
  v_account_attnum smallint;
  v_contact_attnum smallint;
begin
  if to_regclass('public.opportunities') is null then
    return;
  end if;

  select a.attnum::smallint
  into v_account_attnum
  from pg_attribute a
  where a.attrelid = 'public.opportunities'::regclass
    and a.attname = 'account_id'
    and not a.attisdropped
  limit 1;

  select a.attnum::smallint
  into v_contact_attnum
  from pg_attribute a
  where a.attrelid = 'public.opportunities'::regclass
    and a.attname = 'primary_contact_id'
    and not a.attisdropped
  limit 1;

  if v_account_attnum is not null and not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.opportunities'::regclass
      and c.contype = 'f'
      and c.conkey = array[v_account_attnum]::smallint[]
      and c.confrelid = 'public.accounts'::regclass
  ) then
    alter table public.opportunities
      add constraint opportunities_account_id_fkey
      foreign key (account_id) references public.accounts(id) on delete set null;
  end if;

  if v_contact_attnum is not null and not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.opportunities'::regclass
      and c.contype = 'f'
      and c.conkey = array[v_contact_attnum]::smallint[]
      and c.confrelid = 'public.contacts'::regclass
  ) then
    alter table public.opportunities
      add constraint opportunities_primary_contact_id_fkey
      foreign key (primary_contact_id) references public.contacts(id) on delete set null;
  end if;
end $$;

create index if not exists opportunities_account_idx
  on public.opportunities (account_id);

create index if not exists opportunities_primary_contact_idx
  on public.opportunities (primary_contact_id);

-- 5) Org membership lock (one org per user)
do $$
begin
  if to_regclass('public.org_users') is null then
    return;
  end if;

  with ranked as (
    select
      ctid,
      row_number() over (
        partition by user_id
        order by created_at asc, org_id asc
      ) as rn
    from public.org_users
  )
  delete from public.org_users ou
  using ranked r
  where ou.ctid = r.ctid
    and r.rn > 1;

  create unique index if not exists org_users_user_id_unique
    on public.org_users (user_id);
end $$;

-- 6) Touchpoints immutability:
-- remove update policies and add restrictive deny policies for UPDATE/DELETE.
do $$
begin
  if to_regclass('public.touchpoints') is null then
    return;
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'touchpoints'
      and policyname = 'touchpoints_update_manager_only'
  ) then
    execute 'drop policy touchpoints_update_manager_only on public.touchpoints';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'touchpoints'
      and policyname = 'touchpoints_no_update'
  ) then
    execute 'create policy touchpoints_no_update
             on public.touchpoints
             as restrictive
             for update
             to authenticated
             using (false)
             with check (false)';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'touchpoints'
      and policyname = 'touchpoints_no_delete'
  ) then
    execute 'create policy touchpoints_no_delete
             on public.touchpoints
             as restrictive
             for delete
             to authenticated
             using (false)';
  end if;
end $$;

-- Optional hardening: disable manager touchpoint edit RPC to keep ledger immutable.
do $$
begin
  if to_regprocedure(
    'public.rpc_manager_update_touchpoint_with_revision(uuid,text,timestamptz,text,text)'
  ) is not null then
    revoke execute on function public.rpc_manager_update_touchpoint_with_revision(
      uuid, text, timestamptz, text, text
    ) from authenticated;
  end if;
end $$;

commit;
