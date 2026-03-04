-- Migration: add roof metadata columns to properties
-- Session 9: Property intelligence hub

begin;

alter table if exists public.properties
  add column if not exists roof_type      text,
  add column if not exists roof_age_years int,
  add column if not exists sq_footage     int;

commit;
