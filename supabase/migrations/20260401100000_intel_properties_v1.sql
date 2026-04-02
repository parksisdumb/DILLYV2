-- intel_properties: Global commercial property database
-- NO RLS — service role only, same pattern as intel_prospects/intel_entities

begin;

create table if not exists intel_properties (
  id                  uuid primary key default gen_random_uuid(),
  street_address      text,
  city                text,
  state               text,
  postal_code         text,
  country             text default 'US',
  lat                 numeric(10,7),
  lng                 numeric(10,7),
  property_name       text,
  property_type       text,
  sq_footage          integer,
  year_built          integer,
  roof_type           text,
  roof_age_years      integer,
  roof_last_replaced  date,
  roof_sq_footage     integer,
  roof_condition      text,
  owner_name          text,
  owner_type          text,
  entity_id           uuid references intel_entities(id) on delete set null,
  source_detail       text not null,
  source_url          text,
  external_id         text,
  confidence_score    integer default 25,
  last_verified_at    timestamptz default now(),
  is_active           boolean default true,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- Dedup on normalized address
create unique index if not exists intel_properties_address_idx
  on intel_properties(lower(street_address), lower(city), lower(state))
  where street_address is not null;

create index if not exists intel_properties_city_state_idx
  on intel_properties(city, state);

create index if not exists intel_properties_entity_idx
  on intel_properties(entity_id);

create index if not exists intel_properties_type_idx
  on intel_properties(property_type);

create index if not exists intel_properties_owner_idx
  on intel_properties(lower(owner_name));

-- Updated_at trigger
drop trigger if exists trg_intel_properties_updated_at on intel_properties;
create trigger trg_intel_properties_updated_at
  before update on intel_properties
  for each row execute function public.set_updated_at();

-- Link org properties to global intel layer
alter table properties
  add column if not exists intel_property_id uuid references intel_properties(id) on delete set null;

create index if not exists properties_intel_id_idx
  on properties(intel_property_id);

commit;
