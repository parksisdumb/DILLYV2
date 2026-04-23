-- Make properties.name a required identifier.
-- Reps treat the name as the primary way to refer to a property; address is data.
--
-- Strategy:
--   1. Backfill any existing nameless rows with their address_line1
--   2. Install a BEFORE INSERT/UPDATE trigger that auto-fills name from
--      address_line1 whenever name is null/blank. This protects every insert
--      path (RPCs, frontend direct inserts, intel pipeline, seed) without
--      having to touch each one.
--   3. Enforce NOT NULL on properties.name
--
-- After this runs, every property is guaranteed to have a non-blank name,
-- and the UI is free to require/promote name as the canonical identifier.

begin;

-- 1. Backfill
update public.properties
   set name = address_line1
 where name is null
    or btrim(name) = '';

-- 2. Trigger to keep name non-null on every write
create or replace function public.ensure_property_name()
returns trigger
language plpgsql
as $$
begin
  if new.name is null or btrim(new.name) = '' then
    new.name := new.address_line1;
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_property_name_trg on public.properties;
create trigger ensure_property_name_trg
  before insert or update on public.properties
  for each row
  execute function public.ensure_property_name();

-- 3. Enforce NOT NULL
alter table public.properties
  alter column name set not null;

commit;
