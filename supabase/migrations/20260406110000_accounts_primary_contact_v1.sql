-- Add primary_contact_id to accounts table
alter table accounts add column if not exists primary_contact_id uuid references public.contacts(id) on delete set null;
