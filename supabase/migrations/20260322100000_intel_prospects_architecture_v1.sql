-- Session M2-1: intel_prospects architecture
-- Three tables, NO RLS — accessed exclusively via service role (createAdminClient)

-- ─── intel_prospects ─────────────────────────────────────────────────────────
-- Global prospect staging area. NOT org-scoped.
-- "Push to Dilly" copies qualifying records into org-scoped prospects table.

create table if not exists intel_prospects (
  id                        uuid primary key default gen_random_uuid(),

  -- company info
  company_name              text not null,
  company_website           text,
  company_phone             text,
  domain_normalized         text,
  account_type              text,
  vertical                  text,

  -- address
  address_line1             text,
  city                      text,
  state                     text,
  postal_code               text,
  lat                       numeric,
  lng                       numeric,

  -- building / roof
  building_sq_footage       integer,
  year_built                integer,
  roof_type                 text,
  building_type             text,
  facility_type             text,
  roof_measurement_sqft     integer,
  roof_measurement_confidence integer,
  roof_measurement_status   text default 'pending',

  -- ownership
  owner_name_legal          text,
  owner_name_resolved       text,
  new_owner_signal          boolean default false,
  ownership_transfer_date   date,

  -- storm
  storm_priority            boolean default false,
  storm_event_date          date,
  storm_type                text,

  -- contact
  contact_first_name        text,
  contact_last_name         text,
  contact_title             text,
  contact_email             text,
  contact_phone             text,

  -- scoring
  confidence_score          integer not null default 0,
  score_breakdown           jsonb default '[]'::jsonb,

  -- source tracking
  source                    text not null default 'agent',
  source_detail             text not null,
  agent_run_id              uuid,
  agent_metadata            jsonb,

  -- enrichment
  enrichment_status         text default 'pending',

  -- linking to Dilly org data
  dilly_org_id              uuid,
  dilly_prospect_id         uuid,

  -- lifecycle
  status                    text not null default 'active'
                            check (status in ('active','pushed','dismissed','stale')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- Dedup indexes
create unique index if not exists intel_prospects_domain_dedupe_idx
  on intel_prospects (domain_normalized)
  where domain_normalized is not null;

create unique index if not exists intel_prospects_address_dedupe_idx
  on intel_prospects (postal_code, lower(address_line1))
  where address_line1 is not null and postal_code is not null;

-- Query indexes
create index if not exists intel_prospects_status_idx on intel_prospects (status);
create index if not exists intel_prospects_source_idx on intel_prospects (source_detail);
create index if not exists intel_prospects_confidence_idx on intel_prospects (confidence_score);
create index if not exists intel_prospects_dilly_org_idx on intel_prospects (dilly_org_id) where dilly_org_id is not null;

-- updated_at trigger
drop trigger if exists trg_intel_prospects_updated_at on intel_prospects;
create trigger trg_intel_prospects_updated_at
  before update on intel_prospects
  for each row execute function set_updated_at();

-- ─── reit_universe ───────────────────────────────────────────────────────────
-- SEC EDGAR REIT company index for the 3-step EDGAR pipeline

create table if not exists reit_universe (
  id                        uuid primary key default gen_random_uuid(),
  cik                       text not null unique,
  name                      text not null,
  ticker                    text,
  sic                       text,
  exchange                  text,
  last_10k_date             date,
  last_10k_accession        text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

drop trigger if exists trg_reit_universe_updated_at on reit_universe;
create trigger trg_reit_universe_updated_at
  before update on reit_universe
  for each row execute function set_updated_at();

-- ─── agent_registry ──────────────────────────────────────────────────────────
-- Configuration and stats for each agent source

create table if not exists agent_registry (
  agent_name                text primary key,
  display_name              text not null,
  enabled                   boolean not null default true,
  schedule                  text not null,
  last_run_at               timestamptz,
  run_count                 integer not null default 0,
  total_found               integer not null default 0,
  total_inserted            integer not null default 0,
  config                    jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

drop trigger if exists trg_agent_registry_updated_at on agent_registry;
create trigger trg_agent_registry_updated_at
  before update on agent_registry
  for each row execute function set_updated_at();

-- Seed agent registry
insert into agent_registry (agent_name, display_name, schedule, config) values
  ('edgar_10k',        'SEC EDGAR 10-K',   '0 2 1 * *',   '{"max_reits_per_run": 15, "sic_codes": ["6798","6552","6512","6726"]}'::jsonb),
  ('google_places',    'Google Places',     '0 3 * * 1',   '{"max_queries_per_city": 2}'::jsonb),
  ('web_intelligence', 'Web Intelligence',  '0 4 * * 1',   '{"max_queries_per_city": 3, "min_results_per_query": 5}'::jsonb)
on conflict (agent_name) do nothing;
