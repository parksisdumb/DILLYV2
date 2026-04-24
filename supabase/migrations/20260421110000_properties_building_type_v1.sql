-- Add building_type to properties (occupancy class — office, retail, industrial, etc.)
-- Free-text column matching the pattern of roof_type. Optional.
alter table public.properties add column if not exists building_type text;
