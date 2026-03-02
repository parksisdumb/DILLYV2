begin;

-- Ensure contact/account columns exist (safe if already present).
alter table if exists public.next_actions
  add column if not exists contact_id uuid;

alter table if exists public.next_actions
  add column if not exists account_id uuid;

-- Ensure foreign keys exist.
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

-- Backfill contact from opportunity first.
update public.next_actions na
set contact_id = o.primary_contact_id,
    account_id = coalesce(na.account_id, o.account_id)
from public.opportunities o
where na.contact_id is null
  and na.opportunity_id = o.id
  and o.org_id = na.org_id
  and o.primary_contact_id is not null;

-- Backfill from property primary contact.
update public.next_actions na
set contact_id = p.primary_contact_id,
    account_id = coalesce(na.account_id, p.primary_account_id)
from public.properties p
where na.contact_id is null
  and na.property_id = p.id
  and p.org_id = na.org_id
  and p.primary_contact_id is not null;

-- Backfill from property_contacts (if table exists).
do $$
begin
  if to_regclass('public.property_contacts') is null then
    return;
  end if;

  with candidate as (
    select
      na.id as next_action_id,
      pc.contact_id,
      row_number() over (
        partition by na.id
        order by
          coalesce(pc.is_primary, false) desc,
          coalesce(pc.priority_rank, 0) asc,
          pc.updated_at desc nulls last,
          pc.created_at desc
      ) as rn
    from public.next_actions na
    join public.property_contacts pc
      on pc.org_id = na.org_id
     and pc.property_id = na.property_id
     and coalesce(pc.active, true)
    where na.contact_id is null
  )
  update public.next_actions na
  set contact_id = c.contact_id
  from candidate c
  where na.id = c.next_action_id
    and c.rn = 1;
end $$;

-- Backfill from account-linked contacts where possible.
with candidate as (
  select
    na.id as next_action_id,
    c.id as contact_id,
    row_number() over (
      partition by na.id
      order by c.updated_at desc nulls last, c.created_at desc
    ) as rn
  from public.next_actions na
  join public.contacts c
    on c.org_id = na.org_id
   and c.deleted_at is null
   and c.account_id = coalesce(
     na.account_id,
     (select p.primary_account_id from public.properties p where p.id = na.property_id and p.org_id = na.org_id)
   )
  where na.contact_id is null
)
update public.next_actions na
set contact_id = candidate.contact_id
from candidate
where na.id = candidate.next_action_id
  and candidate.rn = 1;

-- Backfill from historical touchpoints on the same opportunity.
with candidate as (
  select
    na.id as next_action_id,
    t.contact_id,
    row_number() over (
      partition by na.id
      order by t.happened_at desc, t.created_at desc
    ) as rn
  from public.next_actions na
  join public.touchpoints t
    on t.org_id = na.org_id
   and t.opportunity_id = na.opportunity_id
   and t.contact_id is not null
  where na.contact_id is null
    and na.opportunity_id is not null
)
update public.next_actions na
set contact_id = candidate.contact_id
from candidate
where na.id = candidate.next_action_id
  and candidate.rn = 1;

-- Backfill from historical touchpoints on the same property.
with candidate as (
  select
    na.id as next_action_id,
    t.contact_id,
    row_number() over (
      partition by na.id
      order by t.happened_at desc, t.created_at desc
    ) as rn
  from public.next_actions na
  join public.touchpoints t
    on t.org_id = na.org_id
   and t.property_id = na.property_id
   and t.contact_id is not null
  where na.contact_id is null
)
update public.next_actions na
set contact_id = candidate.contact_id
from candidate
where na.id = candidate.next_action_id
  and candidate.rn = 1;

-- Final fallback: any active contact in org (old data rescue path).
with candidate as (
  select
    na.id as next_action_id,
    c.id as contact_id,
    row_number() over (
      partition by na.id
      order by c.updated_at desc nulls last, c.created_at desc
    ) as rn
  from public.next_actions na
  join public.contacts c
    on c.org_id = na.org_id
   and c.deleted_at is null
  where na.contact_id is null
)
update public.next_actions na
set contact_id = candidate.contact_id
from candidate
where na.id = candidate.next_action_id
  and candidate.rn = 1;

-- Force account_id to match resolved contact.account_id.
update public.next_actions na
set account_id = c.account_id
from public.contacts c
where na.contact_id = c.id
  and na.org_id = c.org_id
  and (na.account_id is null or na.account_id is distinct from c.account_id);

create index if not exists next_actions_org_assigned_status_due_idx
  on public.next_actions (org_id, assigned_user_id, status, due_at);

create index if not exists next_actions_org_contact_idx
  on public.next_actions (org_id, contact_id);

-- Enforce invariant: no next action without contact.
do $$
declare
  v_missing int;
begin
  select count(*) into v_missing
  from public.next_actions na
  where na.contact_id is null;

  if v_missing > 0 then
    raise exception 'Cannot enforce next_actions.contact_id NOT NULL: % rows still missing contact_id', v_missing;
  end if;
end $$;

alter table public.next_actions
  alter column contact_id set not null;

-- Update RPC: contact is always required (explicit or resolvable).
drop function if exists public.rpc_create_next_action(
  uuid, uuid, uuid, timestamptz, text, uuid
);
drop function if exists public.rpc_create_next_action(
  uuid, uuid, uuid, timestamptz, text, uuid, uuid
);

create function public.rpc_create_next_action(
  p_property_id uuid,
  p_opportunity_id uuid default null,
  p_assigned_user_id uuid default null,
  p_due_at timestamptz default null,
  p_notes text default null,
  p_recommended_touchpoint_type_id uuid default null,
  p_contact_id uuid default null
)
returns public.next_actions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role text;
  v_property_org_id uuid;
  v_property_primary_contact_id uuid;
  v_property_primary_account_id uuid;
  v_opp_org_id uuid;
  v_opp_primary_contact_id uuid;
  v_opp_account_id uuid;
  v_assigned_user_id uuid := coalesce(p_assigned_user_id, auth.uid());
  v_assigned_user_org_id uuid;
  v_type_org_id uuid;
  v_resolved_contact_id uuid;
  v_contact_org_id uuid;
  v_contact_account_id uuid;
  v_row public.next_actions;
begin
  select m.org_id, m.role into v_org_id, v_role
  from public.rpc_get_my_org() m;

  select p.org_id, p.primary_contact_id, p.primary_account_id
  into v_property_org_id, v_property_primary_contact_id, v_property_primary_account_id
  from public.properties p
  where p.id = p_property_id;

  if v_property_org_id is null then
    raise exception 'Property not found';
  end if;
  if v_property_org_id <> v_org_id then
    raise exception 'Property is not in your organization';
  end if;

  if p_opportunity_id is not null then
    select o.org_id, o.primary_contact_id, o.account_id
    into v_opp_org_id, v_opp_primary_contact_id, v_opp_account_id
    from public.opportunities o
    where o.id = p_opportunity_id;

    if v_opp_org_id is null then
      raise exception 'Opportunity not found';
    end if;
    if v_opp_org_id <> v_org_id then
      raise exception 'Opportunity is not in your organization';
    end if;
  end if;

  select ou.org_id
  into v_assigned_user_org_id
  from public.org_users ou
  where ou.user_id = v_assigned_user_id
  limit 1;

  if v_assigned_user_org_id is null or v_assigned_user_org_id <> v_org_id then
    raise exception 'Assigned user is not in your organization';
  end if;

  if p_recommended_touchpoint_type_id is not null then
    select tt.org_id
    into v_type_org_id
    from public.touchpoint_types tt
    where tt.id = p_recommended_touchpoint_type_id;

    if v_type_org_id is null and not exists (
      select 1 from public.touchpoint_types tt where tt.id = p_recommended_touchpoint_type_id and tt.org_id is null
    ) then
      raise exception 'Recommended touchpoint type not found';
    end if;

    if v_type_org_id is not null and v_type_org_id <> v_org_id then
      raise exception 'Recommended touchpoint type is not in your organization';
    end if;
  end if;

  if p_due_at is null then
    raise exception 'due_at is required';
  end if;

  v_resolved_contact_id := coalesce(p_contact_id, v_opp_primary_contact_id, v_property_primary_contact_id);

  if v_resolved_contact_id is null then
    raise exception 'contact_id is required for next actions';
  end if;

  select c.org_id, c.account_id
  into v_contact_org_id, v_contact_account_id
  from public.contacts c
  where c.id = v_resolved_contact_id;

  if v_contact_org_id is null then
    raise exception 'Contact not found';
  end if;
  if v_contact_org_id <> v_org_id then
    raise exception 'Contact is not in your organization';
  end if;
  if v_contact_account_id is null then
    raise exception 'Contact must have account_id';
  end if;

  insert into public.next_actions (
    org_id, property_id, contact_id, account_id, opportunity_id, assigned_user_id, due_at, notes,
    recommended_touchpoint_type_id, status, created_by
  )
  values (
    v_org_id,
    p_property_id,
    v_resolved_contact_id,
    v_contact_account_id,
    p_opportunity_id,
    v_assigned_user_id,
    p_due_at,
    p_notes,
    p_recommended_touchpoint_type_id,
    'open',
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.rpc_create_next_action(
  uuid, uuid, uuid, timestamptz, text, uuid, uuid
) from public;
grant execute on function public.rpc_create_next_action(
  uuid, uuid, uuid, timestamptz, text, uuid, uuid
) to authenticated;

commit;
