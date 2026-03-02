begin;

alter table if exists public.next_actions
  add column if not exists contact_id uuid;

alter table if exists public.next_actions
  add column if not exists account_id uuid;

do $$
declare
  v_contact_attnum smallint;
  v_account_attnum smallint;
begin
  if to_regclass('public.next_actions') is null then
    return;
  end if;

  select a.attnum::smallint
  into v_contact_attnum
  from pg_attribute a
  where a.attrelid = 'public.next_actions'::regclass
    and a.attname = 'contact_id'
    and not a.attisdropped
  limit 1;

  if v_contact_attnum is not null and not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.next_actions'::regclass
      and c.contype = 'f'
      and c.conkey = array[v_contact_attnum]::smallint[]
      and c.confrelid = 'public.contacts'::regclass
  ) then
    alter table public.next_actions
      add constraint next_actions_contact_id_fkey
      foreign key (contact_id) references public.contacts(id) on delete set null;
  end if;

  select a.attnum::smallint
  into v_account_attnum
  from pg_attribute a
  where a.attrelid = 'public.next_actions'::regclass
    and a.attname = 'account_id'
    and not a.attisdropped
  limit 1;

  if v_account_attnum is not null and not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.next_actions'::regclass
      and c.contype = 'f'
      and c.conkey = array[v_account_attnum]::smallint[]
      and c.confrelid = 'public.accounts'::regclass
  ) then
    alter table public.next_actions
      add constraint next_actions_account_id_fkey
      foreign key (account_id) references public.accounts(id) on delete set null;
  end if;
end $$;

-- 1) Prefer opportunity primary contact when available.
update public.next_actions na
set contact_id = o.primary_contact_id
from public.opportunities o
where na.contact_id is null
  and na.opportunity_id = o.id
  and o.primary_contact_id is not null
  and o.org_id = na.org_id;

-- 2) Fallback to property primary contact.
update public.next_actions na
set contact_id = p.primary_contact_id
from public.properties p
where na.contact_id is null
  and na.property_id = p.id
  and p.primary_contact_id is not null
  and p.org_id = na.org_id;

create index if not exists next_actions_org_assigned_status_due_idx
  on public.next_actions (org_id, assigned_user_id, status, due_at);

create index if not exists next_actions_org_contact_idx
  on public.next_actions (org_id, contact_id);

commit;
