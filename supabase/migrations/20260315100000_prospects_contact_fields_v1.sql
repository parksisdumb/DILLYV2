-- Add contact-level fields to prospects table for CSV import mapping

alter table public.prospects add column contact_first_name text;
alter table public.prospects add column contact_last_name text;
alter table public.prospects add column contact_title text;
