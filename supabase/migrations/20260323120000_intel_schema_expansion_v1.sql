-- Intel Schema Expansion
-- Renames reit_universe → intel_entities, adds columns to intel_prospects,
-- creates intel_contacts and intel_tenants tables.
-- All tables: NO RLS — accessed via service role only.

-- ═══════════════════════════════════════════════════════════════════════════════
-- Change 1: Rename reit_universe → intel_entities and expand
-- ═══════════════════════════════════════════════════════════════════════════════

alter table reit_universe rename to intel_entities;

-- Rename triggers and indexes
alter index reit_universe_pkey rename to intel_entities_pkey;
alter index reit_universe_cik_key rename to intel_entities_cik_key;
drop trigger if exists trg_reit_universe_updated_at on intel_entities;
create trigger trg_intel_entities_updated_at
  before update on intel_entities
  for each row execute function set_updated_at();

-- Add new columns
alter table intel_entities add column if not exists entity_type text default 'reit';
alter table intel_entities add column if not exists hq_address_line1 text;
alter table intel_entities add column if not exists hq_city text;
alter table intel_entities add column if not exists hq_state text;
alter table intel_entities add column if not exists hq_postal_code text;
alter table intel_entities add column if not exists total_properties integer;
alter table intel_entities add column if not exists total_sqft bigint;
alter table intel_entities add column if not exists website text;
alter table intel_entities add column if not exists ir_contact_name text;
alter table intel_entities add column if not exists ir_contact_email text;
alter table intel_entities add column if not exists ir_contact_phone text;
alter table intel_entities add column if not exists enabled boolean default true;

-- Index on entity_type for filtering
create index if not exists intel_entities_type_idx on intel_entities (entity_type);
create index if not exists intel_entities_enabled_idx on intel_entities (enabled) where enabled = true;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Change 2: Add missing columns to intel_prospects
-- ═══════════════════════════════════════════════════════════════════════════════

alter table intel_prospects add column if not exists entity_id uuid references intel_entities(id) on delete set null;
alter table intel_prospects add column if not exists tenant_name text;
alter table intel_prospects add column if not exists tenant_industry text;
alter table intel_prospects add column if not exists lease_expiration_year integer;
alter table intel_prospects add column if not exists parcel_id text;
alter table intel_prospects add column if not exists property_manager_name text;
alter table intel_prospects add column if not exists property_manager_company text;
alter table intel_prospects add column if not exists last_sale_date date;
alter table intel_prospects add column if not exists last_sale_price_usd integer;
-- roof_age_estimate computed at query time, not stored (now() is not immutable)
-- Use: EXTRACT(YEAR FROM NOW())::integer - year_built in queries instead
alter table intel_prospects add column if not exists data_sources jsonb default '[]'::jsonb;
alter table intel_prospects add column if not exists verified boolean default false;
alter table intel_prospects add column if not exists verified_at timestamptz;

create index if not exists intel_prospects_entity_idx on intel_prospects (entity_id) where entity_id is not null;
create index if not exists intel_prospects_tenant_idx on intel_prospects (tenant_name) where tenant_name is not null;
create index if not exists intel_prospects_parcel_idx on intel_prospects (parcel_id) where parcel_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Change 3: Create intel_contacts table
-- ═══════════════════════════════════════════════════════════════════════════════

create table if not exists intel_contacts (
  id                    uuid primary key default gen_random_uuid(),
  intel_prospect_id     uuid references intel_prospects(id) on delete cascade,
  intel_entity_id       uuid references intel_entities(id) on delete cascade,
  first_name            text,
  last_name             text,
  full_name             text,
  title                 text,
  contact_type          text not null default 'unknown'
                        check (contact_type in (
                          'owner','property_manager','facilities_director',
                          'asset_manager','leasing_agent','executive',
                          'board_member','unknown'
                        )),
  email                 text,
  phone                 text,
  linkedin_url          text,
  confidence_score      integer default 0,
  source_detail         text not null,
  verified              boolean default false,
  verified_at           timestamptz,
  agent_metadata        jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- No RLS — service role only
create index if not exists intel_contacts_prospect_idx on intel_contacts (intel_prospect_id);
create index if not exists intel_contacts_entity_idx on intel_contacts (intel_entity_id);
create index if not exists intel_contacts_type_idx on intel_contacts (contact_type);
create index if not exists intel_contacts_email_idx on intel_contacts (email) where email is not null;

drop trigger if exists trg_intel_contacts_updated_at on intel_contacts;
create trigger trg_intel_contacts_updated_at
  before update on intel_contacts
  for each row execute function set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════
-- Change 4: Create intel_tenants table
-- ═══════════════════════════════════════════════════════════════════════════════

create table if not exists intel_tenants (
  id                    uuid primary key default gen_random_uuid(),
  intel_prospect_id     uuid references intel_prospects(id) on delete cascade,
  intel_entity_id       uuid references intel_entities(id) on delete set null,
  tenant_name           text not null,
  tenant_industry       text,
  tenant_type           text
                        check (tenant_type is null or tenant_type in (
                          'national_chain','regional','local','government',
                          'healthcare','education'
                        )),
  property_count        integer,
  pct_of_rent           numeric(5,2),
  lease_expiration_year integer,
  lease_type            text
                        check (lease_type is null or lease_type in (
                          'net','gross','modified_gross'
                        )),
  national_account      boolean default false,
  source_detail         text not null,
  agent_metadata        jsonb,
  created_at            timestamptz not null default now()
);

-- No RLS — service role only
create index if not exists intel_tenants_prospect_idx on intel_tenants (intel_prospect_id);
create index if not exists intel_tenants_entity_idx on intel_tenants (intel_entity_id);
create index if not exists intel_tenants_name_idx on intel_tenants (tenant_name);
create index if not exists intel_tenants_national_idx on intel_tenants (national_account) where national_account = true;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Change 6: Update agent_registry with new entries
-- ═══════════════════════════════════════════════════════════════════════════════

insert into agent_registry (agent_name, display_name, schedule, enabled, config) values
  ('intel_contacts_enrichment', 'Contact Enrichment', '0 6 * * 1', false,
   '{"providers": ["batchdata", "proptracer"], "max_enrichments_per_run": 50}'::jsonb)
on conflict (agent_name) do nothing;

-- reit_website_properties may already exist from prior migration
insert into agent_registry (agent_name, display_name, schedule, enabled, config) values
  ('reit_website_properties', 'REIT Website Properties', '0 5 * * 1', false,
   '{"urls": {"agree_realty": "agreerealty.com/properties", "realty_income": "realtyincome.com/properties", "nnn": "nnnreit.com/portfolio"}}'::jsonb)
on conflict (agent_name) do nothing;
