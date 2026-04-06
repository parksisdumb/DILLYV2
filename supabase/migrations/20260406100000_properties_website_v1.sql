-- Add website field to properties table
alter table properties add column if not exists website text;
