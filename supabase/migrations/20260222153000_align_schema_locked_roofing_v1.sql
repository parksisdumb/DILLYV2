begin;

-- =========================================================
-- align_schema_locked_roofing_v1
-- Align existing schema to locked Dilly v2 roofing spec while
-- preserving backward compatibility where possible.
-- =========================================================

-- A) Enforce one-org-per-user.
create unique index if not exists org_users_user_id_unique
  on public.org_users (user_id);

-- B) Soft delete canonicalization.
alter table if exists public.accounts
  add column if not exists deleted_at timestamptz;

alter table if exists public.contacts
  add column if not exists deleted_at timestamptz;

alter table if exists public.properties
  add column if not exists deleted_at timestamptz;

alter table if exists public.opportunities
  add column if not exists deleted_at timestamptz;

-- C) Contacts alignment (keep full_name for compatibility).
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

-- D) Property-Account relationship history (required).
create table if not exists public.property_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  relationship_type text not null
    check (relationship_type in ('owner', 'property_manager', 'gc', 'consultant', 'vendor', 'other')),
  is_primary boolean not null default false,
  active boolean not null default true,
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

alter table if exists public.property_accounts
  add column if not exists id uuid;
alter table if exists public.property_accounts
  add column if not exists org_id uuid;
alter table if exists public.property_accounts
  add column if not exists property_id uuid;
alter table if exists public.property_accounts
  add column if not exists account_id uuid;
alter table if exists public.property_accounts
  add column if not exists relationship_type text;
alter table if exists public.property_accounts
  add column if not exists is_primary boolean;
alter table if exists public.property_accounts
  add column if not exists active boolean;
alter table if exists public.property_accounts
  add column if not exists starts_on date;
alter table if exists public.property_accounts
  add column if not exists ends_on date;
alter table if exists public.property_accounts
  add column if not exists created_at timestamptz;
alter table if exists public.property_accounts
  add column if not exists created_by uuid;

do $$
declare
  v_pk_name text;
  v_pk_cols text[];
begin
  if to_regclass('public.property_accounts') is null then
    return;
  end if;

  update public.property_accounts pa
  set org_id = coalesce(
    pa.org_id,
    (select p.org_id from public.properties p where p.id = pa.property_id),
    (select a.org_id from public.accounts a where a.id = pa.account_id)
  )
  where pa.org_id is null;

  update public.property_accounts
  set id = gen_random_uuid()
  where id is null;

  update public.property_accounts
  set is_primary = false
  where is_primary is null;

  update public.property_accounts
  set active = true
  where active is null;

  update public.property_accounts
  set created_at = now()
  where created_at is null;

  alter table public.property_accounts
    alter column id set default gen_random_uuid();
  alter table public.property_accounts
    alter column is_primary set default false;
  alter table public.property_accounts
    alter column active set default true;
  alter table public.property_accounts
    alter column created_at set default now();

  if exists (
    select 1
    from public.property_accounts
    where org_id is null
       or property_id is null
       or account_id is null
       or relationship_type is null
  ) then
    raise exception 'property_accounts has null required fields; fix rows before enforcing constraints';
  end if;

  alter table public.property_accounts
    alter column id set not null;
  alter table public.property_accounts
    alter column org_id set not null;
  alter table public.property_accounts
    alter column property_id set not null;
  alter table public.property_accounts
    alter column account_id set not null;
  alter table public.property_accounts
    alter column relationship_type set not null;
  alter table public.property_accounts
    alter column is_primary set not null;
  alter table public.property_accounts
    alter column active set not null;
  alter table public.property_accounts
    alter column created_at set not null;

  select
    c.conname,
    array_agg(att.attname order by k.ord)
  into v_pk_name, v_pk_cols
  from pg_constraint c
  join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
  join pg_attribute att
    on att.attrelid = c.conrelid
   and att.attnum = k.attnum
  where c.conrelid = 'public.property_accounts'::regclass
    and c.contype = 'p'
  group by c.conname
  limit 1;

  if v_pk_name is not null and v_pk_cols <> array['id']::text[] then
    execute format('alter table public.property_accounts drop constraint %I', v_pk_name);
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.property_accounts'::regclass
      and c.contype = 'p'
  ) then
    alter table public.property_accounts
      add constraint property_accounts_pkey primary key (id);
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.property_accounts'::regclass
      and c.conname = 'property_accounts_org_id_fkey'
  ) then
    alter table public.property_accounts
      add constraint property_accounts_org_id_fkey
      foreign key (org_id) references public.orgs(id) on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.property_accounts'::regclass
      and c.conname = 'property_accounts_property_id_fkey'
  ) then
    alter table public.property_accounts
      add constraint property_accounts_property_id_fkey
      foreign key (property_id) references public.properties(id) on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.property_accounts'::regclass
      and c.conname = 'property_accounts_account_id_fkey'
  ) then
    alter table public.property_accounts
      add constraint property_accounts_account_id_fkey
      foreign key (account_id) references public.accounts(id) on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.property_accounts'::regclass
      and c.conname = 'property_accounts_created_by_fkey'
  ) then
    alter table public.property_accounts
      add constraint property_accounts_created_by_fkey
      foreign key (created_by) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.property_accounts'::regclass
      and c.conname = 'property_accounts_relationship_type_check'
  ) then
    alter table public.property_accounts
      add constraint property_accounts_relationship_type_check
      check (relationship_type in ('owner', 'property_manager', 'gc', 'consultant', 'vendor', 'other'));
  end if;
end $$;

create unique index if not exists property_accounts_unique_with_starts_on
  on public.property_accounts (property_id, account_id, relationship_type, starts_on)
  where starts_on is not null;

create unique index if not exists property_accounts_unique_without_starts_on
  on public.property_accounts (property_id, account_id, relationship_type)
  where starts_on is null;

create index if not exists property_accounts_org_property_idx
  on public.property_accounts (org_id, property_id);

create index if not exists property_accounts_org_account_idx
  on public.property_accounts (org_id, account_id);

-- E) Property-Contact scoped relationships (required).
create table if not exists public.property_contacts (
  org_id uuid not null references public.orgs(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  role_category text not null default 'other',
  role_label text,
  priority_rank int not null default 0,
  is_primary boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (property_id, contact_id, role_category)
);

alter table if exists public.property_contacts
  add column if not exists org_id uuid;
alter table if exists public.property_contacts
  add column if not exists role_category text;
alter table if exists public.property_contacts
  add column if not exists role_label text;
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
declare
  v_pk_name text;
  v_pk_cols text[];
begin
  if to_regclass('public.property_contacts') is null then
    return;
  end if;

  update public.property_contacts pc
  set org_id = coalesce(
    pc.org_id,
    (select p.org_id from public.properties p where p.id = pc.property_id),
    (select c.org_id from public.contacts c where c.id = pc.contact_id)
  )
  where pc.org_id is null;

  update public.property_contacts
  set role_category = coalesce(role_category, 'other')
  where role_category is null;

  -- Preserve prior semantics from older migration shape if column exists.
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'property_contacts'
      and c.column_name = 'relationship_type'
  ) then
    update public.property_contacts
    set role_label = coalesce(role_label, relationship_type)
    where role_label is null
      and relationship_type is not null;
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
    alter column role_category set default 'other';
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

  if exists (
    select 1
    from public.property_contacts
    where org_id is null
       or property_id is null
       or contact_id is null
       or role_category is null
  ) then
    raise exception 'property_contacts has null required fields; fix rows before enforcing constraints';
  end if;

  alter table public.property_contacts
    alter column org_id set not null;
  alter table public.property_contacts
    alter column property_id set not null;
  alter table public.property_contacts
    alter column contact_id set not null;
  alter table public.property_contacts
    alter column role_category set not null;
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

  select
    c.conname,
    array_agg(att.attname order by k.ord)
  into v_pk_name, v_pk_cols
  from pg_constraint c
  join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
  join pg_attribute att
    on att.attrelid = c.conrelid
   and att.attnum = k.attnum
  where c.conrelid = 'public.property_contacts'::regclass
    and c.contype = 'p'
  group by c.conname
  limit 1;

  if v_pk_name is not null
     and v_pk_cols <> array['property_id', 'contact_id', 'role_category']::text[] then
    execute format('alter table public.property_contacts drop constraint %I', v_pk_name);
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.property_contacts'::regclass
      and c.contype = 'p'
  ) then
    alter table public.property_contacts
      add constraint property_contacts_pkey
      primary key (property_id, contact_id, role_category);
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.property_contacts'::regclass
      and c.conname = 'property_contacts_org_id_fkey'
  ) then
    alter table public.property_contacts
      add constraint property_contacts_org_id_fkey
      foreign key (org_id) references public.orgs(id) on delete cascade;
  end if;
end $$;

create index if not exists property_contacts_org_property_idx
  on public.property_contacts (org_id, property_id);

create index if not exists property_contacts_org_contact_idx
  on public.property_contacts (org_id, contact_id);

-- F) Opportunities.
alter table if exists public.opportunities
  add column if not exists deleted_at timestamptz;

alter table if exists public.opportunities
  add column if not exists primary_contact_id uuid;

do $$
declare
  v_contact_attnum smallint;
begin
  if to_regclass('public.opportunities') is null then
    return;
  end if;

  -- Roofing requires property_id.
  if exists (
    select 1
    from public.opportunities
    where property_id is null
  ) then
    raise exception 'Cannot enforce opportunities.property_id NOT NULL: null rows exist';
  end if;

  alter table public.opportunities
    alter column property_id set not null;

  select a.attnum::smallint
  into v_contact_attnum
  from pg_attribute a
  where a.attrelid = 'public.opportunities'::regclass
    and a.attname = 'primary_contact_id'
    and not a.attisdropped
  limit 1;

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

create index if not exists opportunities_primary_contact_idx
  on public.opportunities (primary_contact_id);

-- G) Ensure updated_at triggers on updated_at tables (except touchpoints).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.profiles') is not null then
    drop trigger if exists trg_profiles_updated_at on public.profiles;
    create trigger trg_profiles_updated_at
    before update on public.profiles
    for each row execute function public.set_updated_at();
  end if;

  if to_regclass('public.accounts') is not null then
    drop trigger if exists trg_accounts_updated_at on public.accounts;
    create trigger trg_accounts_updated_at
    before update on public.accounts
    for each row execute function public.set_updated_at();
  end if;

  if to_regclass('public.contacts') is not null then
    drop trigger if exists trg_contacts_updated_at on public.contacts;
    create trigger trg_contacts_updated_at
    before update on public.contacts
    for each row execute function public.set_updated_at();
  end if;

  if to_regclass('public.properties') is not null then
    drop trigger if exists trg_properties_updated_at on public.properties;
    create trigger trg_properties_updated_at
    before update on public.properties
    for each row execute function public.set_updated_at();
  end if;

  if to_regclass('public.opportunities') is not null then
    drop trigger if exists trg_opportunities_updated_at on public.opportunities;
    create trigger trg_opportunities_updated_at
    before update on public.opportunities
    for each row execute function public.set_updated_at();
  end if;

  if to_regclass('public.next_actions') is not null then
    drop trigger if exists trg_next_actions_updated_at on public.next_actions;
    create trigger trg_next_actions_updated_at
    before update on public.next_actions
    for each row execute function public.set_updated_at();
  end if;

  if to_regclass('public.streaks') is not null then
    drop trigger if exists trg_streaks_updated_at on public.streaks;
    create trigger trg_streaks_updated_at
    before update on public.streaks
    for each row execute function public.set_updated_at();
  end if;

  if to_regclass('public.property_contacts') is not null then
    drop trigger if exists trg_property_contacts_updated_at on public.property_contacts;
    create trigger trg_property_contacts_updated_at
    before update on public.property_contacts
    for each row execute function public.set_updated_at();
  end if;
end $$;

commit;
