begin;

-- Lock tenant membership invariant for v1:
-- - one org per user
-- - many users per org
-- We use org_users as canonical membership, while keeping this migration
-- compatible with existing org table names (organizations vs orgs).

-- 1) Create org_users if missing, referencing the existing org table.
do $$
declare
  v_org_table regclass;
begin
  v_org_table := coalesce(
    to_regclass('public.organizations'),
    to_regclass('public.orgs')
  );

  if v_org_table is null then
    raise exception 'Neither public.organizations nor public.orgs exists.';
  end if;

  if to_regclass('public.org_users') is null then
    execute format(
      'create table public.org_users (
         org_id uuid not null references %s(id) on delete cascade,
         user_id uuid not null references auth.users(id) on delete cascade,
         role text not null check (role in (''rep'',''manager'',''admin'')),
         created_at timestamptz not null default now(),
         primary key (org_id, user_id)
       )',
      v_org_table::text
    );
  end if;
end $$;

-- 2) Backfill org_users from existing memberships/roles if those tables exist.
-- We keep the earliest membership per user to satisfy one-org-per-user v1.
do $$
begin
  if to_regclass('public.org_users') is not null
     and to_regclass('public.memberships') is not null
     and to_regclass('public.roles') is not null then
    insert into public.org_users (org_id, user_id, role, created_at)
    select s.org_id, s.user_id, s.role_key, s.created_at
    from (
      select distinct on (m.user_id)
        m.org_id,
        m.user_id,
        coalesce(r.key, 'rep')::text as role_key,
        m.created_at
      from public.memberships m
      left join public.roles r on r.id = m.role_id
      order by m.user_id, m.created_at asc, m.id asc
    ) s
    where not exists (
      select 1
      from public.org_users ou
      where ou.user_id = s.user_id
    );
  end if;
end $$;

-- 3) Enforce constraints/indexes on org_users, and remove bad uniqueness on org_id.
do $$
declare
  v_org_table regclass;
  v_org_attnum smallint;
  v_user_attnum smallint;
  v_pk_cols text[];
  v_con record;
  v_idx record;
begin
  if to_regclass('public.org_users') is null then
    return;
  end if;

  v_org_table := coalesce(
    to_regclass('public.organizations'),
    to_regclass('public.orgs')
  );

  select a.attnum::smallint
  into v_org_attnum
  from pg_attribute a
  where a.attrelid = 'public.org_users'::regclass
    and a.attname = 'org_id'
    and not a.attisdropped
  limit 1;

  select a.attnum::smallint
  into v_user_attnum
  from pg_attribute a
  where a.attrelid = 'public.org_users'::regclass
    and a.attname = 'user_id'
    and not a.attisdropped
  limit 1;

  -- If there are multiple org rows per user already, keep earliest and drop the rest.
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

  -- Ensure PK(org_id, user_id), or fallback uniqueness if PK exists differently.
  select array_agg(att.attname order by k.ord)
  into v_pk_cols
  from pg_constraint c
  join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
  join pg_attribute att
    on att.attrelid = c.conrelid
   and att.attnum = k.attnum
  where c.conrelid = 'public.org_users'::regclass
    and c.contype = 'p';

  if v_pk_cols is null then
    alter table public.org_users
      add constraint org_users_pkey primary key (org_id, user_id);
  elsif v_pk_cols <> array['org_id', 'user_id']::text[] then
    create unique index if not exists org_users_org_user_unique
      on public.org_users (org_id, user_id);
  end if;

  -- Drop UNIQUE(org_id) constraints if any (would break many-users-per-org).
  for v_con in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.org_users'::regclass
      and c.contype = 'u'
      and c.conkey = array[v_org_attnum]::smallint[]
  loop
    execute format('alter table public.org_users drop constraint %I', v_con.conname);
  end loop;

  -- Drop standalone unique indexes on org_id if any.
  for v_idx in
    select idx.relname as index_name
    from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    left join pg_constraint c on c.conindid = i.indexrelid
    where i.indrelid = 'public.org_users'::regclass
      and i.indisunique
      and c.oid is null
      and i.indkey::smallint[] = array[v_org_attnum]::smallint[]
  loop
    execute format('drop index if exists public.%I', v_idx.index_name);
  end loop;

  -- Ensure FK(org_id) points at the current org table.
  if v_org_table is not null then
    for v_con in
      select c.conname
      from pg_constraint c
      where c.conrelid = 'public.org_users'::regclass
        and c.contype = 'f'
        and c.conkey = array[v_org_attnum]::smallint[]
        and c.confrelid <> v_org_table
    loop
      execute format('alter table public.org_users drop constraint %I', v_con.conname);
    end loop;

    if not exists (
      select 1
      from pg_constraint c
      where c.conrelid = 'public.org_users'::regclass
        and c.contype = 'f'
        and c.conkey = array[v_org_attnum]::smallint[]
        and c.confrelid = v_org_table
    ) then
      execute format(
        'alter table public.org_users
           add constraint org_users_org_id_fkey
           foreign key (org_id) references %s(id) on delete cascade',
        v_org_table::text
      );
    end if;
  end if;

  -- Ensure FK(user_id) -> auth.users(id).
  for v_con in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.org_users'::regclass
      and c.contype = 'f'
      and c.conkey = array[v_user_attnum]::smallint[]
      and c.confrelid <> 'auth.users'::regclass
  loop
    execute format('alter table public.org_users drop constraint %I', v_con.conname);
  end loop;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.org_users'::regclass
      and c.contype = 'f'
      and c.conkey = array[v_user_attnum]::smallint[]
      and c.confrelid = 'auth.users'::regclass
  ) then
    alter table public.org_users
      add constraint org_users_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  -- Required indexes for invariant/perf.
  create unique index if not exists org_users_user_id_unique
    on public.org_users (user_id);

  create index if not exists org_users_org_id_idx
    on public.org_users (org_id);
end $$;

-- 3b) Bridge enforcement for current schema usage:
-- current RLS/RPC still uses public.memberships, so lock one-org-per-user there too.
do $$
begin
  if to_regclass('public.memberships') is not null then
    -- Keep the earliest membership row per user.
    with ranked as (
      select
        ctid,
        row_number() over (
          partition by user_id
          order by created_at asc, org_id asc
        ) as rn
      from public.memberships
    )
    delete from public.memberships m
    using ranked r
    where m.ctid = r.ctid
      and r.rn > 1;

    create unique index if not exists memberships_user_id_unique
      on public.memberships (user_id);
  end if;
end $$;

-- 4) Defensive cleanup:
-- delete duplicate org rows only when they are fully orphaned:
-- - no org_users row
-- - no rows in any public table with org_id referencing that org
do $$
declare
  v_org_table regclass;
  v_org_table_name text;
  v_org_table_short text;
  v_org_id uuid;
  v_ref_table text;
  v_has_refs boolean;
begin
  v_org_table := coalesce(
    to_regclass('public.organizations'),
    to_regclass('public.orgs')
  );

  if v_org_table is null then
    return;
  end if;

  v_org_table_name := v_org_table::text;
  v_org_table_short := split_part(v_org_table_name, '.', 2);

  for v_org_id in
    execute format(
      $sql$
      select id
      from (
        select
          o.id,
          row_number() over (
            partition by o.name, o.created_by
            order by o.created_at asc, o.id asc
          ) as rn
        from %s o
      ) d
      where d.rn > 1
      $sql$,
      v_org_table_name
    )
  loop
    -- Must have no org_users membership.
    if exists (
      select 1
      from public.org_users ou
      where ou.org_id = v_org_id
    ) then
      continue;
    end if;

    v_has_refs := false;

    -- Must have no references in any other public table with org_id.
    for v_ref_table in
      select format('%I.%I', c.table_schema, c.table_name)
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.column_name = 'org_id'
        and c.table_name not in (v_org_table_short, 'org_users')
      group by c.table_schema, c.table_name
    loop
      execute format(
        'select exists (select 1 from %s t where t.org_id = $1)',
        v_ref_table
      )
      into v_has_refs
      using v_org_id;

      if v_has_refs then
        exit;
      end if;
    end loop;

    if not v_has_refs then
      execute format(
        'delete from %s where id = $1',
        v_org_table_name
      )
      using v_org_id;
    end if;
  end loop;
end $$;

commit;
