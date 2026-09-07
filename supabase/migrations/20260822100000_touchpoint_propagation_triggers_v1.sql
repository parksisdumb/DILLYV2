-- touchpoint_propagation_triggers_v1
--
-- Write-side propagation, at the TABLE level so no logging path can bypass it
-- (RPCs, future direct inserts — all covered). Two triggers:
--
--   1. BEFORE INSERT — fill account_id from the unambiguous direction when the
--      caller left it null: contact → its account; else property → its primary
--      account. NEVER overwrites a supplied value, and never guesses the
--      ambiguous direction (a property has many contacts; a contact has many
--      properties), so contact_id/property_id are left exactly as given.
--
--   2. AFTER INSERT — when a touch names BOTH a contact and a property, ensure the
--      many-to-many property_contacts link exists (role_category 'other', the app
--      default, so the pair never duplicates), so the relationship shows on both
--      timelines going forward.
--
-- Both functions are SECURITY DEFINER so they can read contacts/properties and
-- write property_contacts regardless of the caller's RLS. Idempotent
-- create-or-replace + drop/create trigger. Apply via the SQL editor.

begin;

create or replace function public.fn_touchpoints_fill_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.account_id is null then
    if new.contact_id is not null then
      select c.account_id into new.account_id
      from public.contacts c where c.id = new.contact_id;
    end if;
    if new.account_id is null and new.property_id is not null then
      select p.primary_account_id into new.account_id
      from public.properties p where p.id = new.property_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_touchpoints_fill_account on public.touchpoints;
create trigger trg_touchpoints_fill_account
before insert on public.touchpoints
for each row execute function public.fn_touchpoints_fill_account();


create or replace function public.fn_touchpoints_link_property_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.contact_id is not null and new.property_id is not null then
    insert into public.property_contacts (org_id, property_id, contact_id, role_category, created_by)
    values (new.org_id, new.property_id, new.contact_id, 'other', new.created_by)
    on conflict (property_id, contact_id, role_category) do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_touchpoints_link_property_contact on public.touchpoints;
create trigger trg_touchpoints_link_property_contact
after insert on public.touchpoints
for each row execute function public.fn_touchpoints_link_property_contact();

commit;
