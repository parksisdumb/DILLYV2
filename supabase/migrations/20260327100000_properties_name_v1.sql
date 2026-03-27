-- Add a human-friendly name to properties (e.g. "Lakewood Office Park")
-- Nullable — existing properties keep NULL and display by address as before.
alter table properties add column if not exists name text;
