-- Add source tracking and city/state to accounts for intel push pipeline
alter table accounts add column if not exists source text;
alter table accounts add column if not exists city text;
alter table accounts add column if not exists state text;

-- Widen prospects.source check constraint to allow 'dilly_intel'
alter table prospects drop constraint if exists prospects_source_check;
alter table prospects add constraint prospects_source_check
  check (source in ('csv_import', 'manual', 'agent', 'dilly_intel'));
