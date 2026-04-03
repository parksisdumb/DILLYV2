-- ICP feedback loop table

begin;

create table if not exists public.icp_feedback (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  account_id     uuid references public.accounts(id) on delete set null,
  touchpoint_id  uuid references public.touchpoints(id) on delete set null,
  feedback_type  text not null, -- 'account_fit', 'deal_quality'
  feedback_value text not null, -- 'yes', 'no', 'too_early', 'perfect', 'good', 'not_ideal'
  created_at     timestamptz not null default now()
);

alter table icp_feedback enable row level security;

create policy icp_feedback_select on icp_feedback for select using (
  org_id in (select ou.org_id from org_users ou where ou.user_id = (select auth.uid()))
);
create policy icp_feedback_insert on icp_feedback for insert with check (
  org_id in (select ou.org_id from org_users ou where ou.user_id = (select auth.uid()))
);

create index icp_feedback_org_idx on icp_feedback(org_id);
create index icp_feedback_account_idx on icp_feedback(account_id);

commit;
