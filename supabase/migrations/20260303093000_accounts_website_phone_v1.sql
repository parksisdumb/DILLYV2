begin;

alter table if exists public.accounts
  add column if not exists website text,
  add column if not exists phone   text;

commit;
