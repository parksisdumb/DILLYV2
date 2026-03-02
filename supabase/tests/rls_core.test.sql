begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

-- Deterministic IDs for test fixtures.
-- org:        aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
-- manager:    11111111-1111-1111-1111-111111111111
-- rep:        22222222-2222-2222-2222-222222222222
-- account A:  bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1
-- account B:  bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2
-- property A: cccccccc-cccc-cccc-cccc-ccccccccccc1 (assigned to rep)
-- property B: cccccccc-cccc-cccc-cccc-ccccccccccc2 (unassigned)

insert into auth.users (id, email, role, aud)
values
  ('11111111-1111-1111-1111-111111111111', 'rls-manager@dilly.dev', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'rls-rep@dilly.dev', 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.orgs (id, name, created_by)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'RLS Test Org',
  '11111111-1111-1111-1111-111111111111'
)
on conflict (id) do nothing;

insert into public.org_users (org_id, user_id, role)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'manager'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'rep')
on conflict (user_id) do update
set org_id = excluded.org_id, role = excluded.role;

insert into public.accounts (id, org_id, name, created_by)
values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'RLS Account Manager', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'RLS Account Rep', '22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

insert into public.contacts (id, org_id, account_id, full_name, created_by)
values
  ('dddddddd-dddd-dddd-dddd-ddddddddddd1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'Manager Contact', '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-dddd-dddd-dddd-ddddddddddd2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'Rep Contact', '22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

insert into public.properties (
  id,
  org_id,
  address_line1,
  city,
  state,
  postal_code,
  country,
  created_by
)
values
  ('cccccccc-cccc-cccc-cccc-ccccccccccc1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '1 Assigned Ave', 'Austin', 'TX', '78701', 'US', '11111111-1111-1111-1111-111111111111'),
  ('cccccccc-cccc-cccc-cccc-ccccccccccc2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2 Unassigned Ave', 'Austin', 'TX', '78702', 'US', '11111111-1111-1111-1111-111111111111')
on conflict (id) do nothing;

insert into public.property_assignments (org_id, property_id, user_id, assignment_role, created_by)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', '22222222-2222-2222-2222-222222222222', 'assigned_rep', '11111111-1111-1111-1111-111111111111')
on conflict (property_id, user_id) do nothing;

create or replace function public.__test_row_count(p_sql text)
returns int
language plpgsql
as $$
declare
  v_count int;
begin
  execute p_sql;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Rep session.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select count(*)::int from public.accounts where org_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  2,
  'rep can SELECT all accounts in same org'
);

select is(
  (select count(*)::int from public.contacts where org_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  2,
  'rep can SELECT all contacts in same org'
);

select is(
  (select count(*)::int from public.properties where org_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  2,
  'rep can SELECT all properties in same org'
);

select is(
  public.__test_row_count($sql$
    update public.properties
    set notes = 'rep-attempt-unassigned'
    where id = 'cccccccc-cccc-cccc-cccc-ccccccccccc2'
  $sql$),
  0,
  'rep cannot UPDATE unassigned property'
);

select is(
  public.__test_row_count($sql$
    update public.properties
    set notes = 'rep-updated-assigned'
    where id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1'
  $sql$),
  1,
  'rep can UPDATE assigned property'
);

select is(
  public.__test_row_count($sql$
    update public.accounts
    set notes = 'rep-attempt-manager-account'
    where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
  $sql$),
  0,
  'rep cannot UPDATE manager-created account'
);

select is(
  public.__test_row_count($sql$
    update public.contacts
    set title = 'rep-attempt-manager-contact'
    where id = 'dddddddd-dddd-dddd-dddd-ddddddddddd1'
  $sql$),
  0,
  'rep cannot UPDATE manager-created contact'
);

-- Manager session.
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  public.__test_row_count($sql$
    update public.properties
    set notes = 'manager-updated-unassigned'
    where id = 'cccccccc-cccc-cccc-cccc-ccccccccccc2'
  $sql$),
  1,
  'manager can UPDATE unassigned property'
);

select is(
  public.__test_row_count($sql$
    update public.accounts
    set notes = 'rep-updated-own-account'
    where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'
  $sql$),
  1,
  'manager can UPDATE account in org'
);

select * from finish();
rollback;
