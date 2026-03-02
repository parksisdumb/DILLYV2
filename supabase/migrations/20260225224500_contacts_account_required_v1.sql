begin;

-- Backfill null contact.account_id with an org-scoped placeholder account.
with orgs_needing_backfill as (
  select distinct c.org_id
  from public.contacts c
  where c.account_id is null
),
existing_unknown as (
  select
    o.org_id,
    min(a.id::text)::uuid as account_id
  from orgs_needing_backfill o
  join public.accounts a
    on a.org_id = o.org_id
   and lower(a.name) = 'unknown account'
  group by o.org_id
),
to_insert as (
  select o.org_id
  from orgs_needing_backfill o
  left join existing_unknown e on e.org_id = o.org_id
  where e.org_id is null
),
inserted_unknown as (
  insert into public.accounts (
    org_id,
    name,
    account_type,
    status,
    notes,
    created_by
  )
  select
    i.org_id,
    'Unknown Account',
    'system_unknown',
    'active',
    'system backfill for contacts with null account_id',
    null::uuid
  from to_insert i
  returning org_id, id as account_id
),
unknown_lookup as (
  select org_id, account_id from existing_unknown
  union all
  select org_id, account_id from inserted_unknown
)
update public.contacts c
set account_id = u.account_id
from unknown_lookup u
where c.org_id = u.org_id
  and c.account_id is null;

do $$
begin
  if exists (
    select 1
    from public.contacts c
    where c.account_id is null
  ) then
    raise exception 'contacts.account_id backfill failed; null values remain';
  end if;
end $$;

alter table if exists public.contacts
  alter column account_id set not null;

create index if not exists contacts_account_idx
  on public.contacts (account_id);

commit;
