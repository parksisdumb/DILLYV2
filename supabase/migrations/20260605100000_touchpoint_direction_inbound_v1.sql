begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Inbound touchpoints
--
-- Adds a `direction` ('inbound' | 'outbound') flag to touchpoints so a rep can
-- log a call/email/text they RECEIVED (the prospect reached out to them) as
-- distinct from proactive outreach. Inbound touchpoints are VISIBILITY-ONLY:
-- they appear on the timeline but award no points and update no streaks, and
-- they never count toward the daily-outreach KPI (the rep did not initiate).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) direction column. Existing rows are outbound by definition.
alter table if exists public.touchpoints
  add column if not exists direction text not null default 'outbound';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'touchpoints_direction_check'
  ) then
    alter table public.touchpoints
      add constraint touchpoints_direction_check
      check (direction in ('inbound', 'outbound'));
  end if;
end $$;

-- 2) Relax the outreach-contact invariant: a contact is only mandatory for
--    OUTBOUND outreach. Inbound touchpoints may be anchored to just an account
--    or property (you don't always know who called).
create or replace function public.enforce_outreach_touchpoint_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_outreach boolean;
begin
  select coalesce(tt.is_outreach, false)
  into v_is_outreach
  from public.touchpoint_types tt
  where tt.id = new.touchpoint_type_id;

  if not found then
    raise exception 'Touchpoint type not found'
      using errcode = '23503';
  end if;

  if v_is_outreach
     and coalesce(new.direction, 'outbound') = 'outbound'
     and new.contact_id is null then
    raise exception 'contact_id is required for outreach touchpoints'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Recreate the trigger so it also re-evaluates when `direction` changes.
drop trigger if exists trg_touchpoints_require_contact_for_outreach on public.touchpoints;
create trigger trg_touchpoints_require_contact_for_outreach
before insert or update of touchpoint_type_id, contact_id, direction
on public.touchpoints
for each row
execute function public.enforce_outreach_touchpoint_contact();

-- 3) RPC: log an inbound touchpoint (received call / email / text).
--    Flexible anchoring — at least one of contact / account / property.
--    Visibility-only: no score_events, no streaks, no KPI impact.
create or replace function public.rpc_log_inbound_touchpoint(
  p_touchpoint_type_id uuid,
  p_contact_id uuid default null,
  p_account_id uuid default null,
  p_property_id uuid default null,
  p_outcome_id uuid default null,
  p_notes text default null,
  p_happened_at timestamptz default now(),
  p_engagement_phase text default 'follow_up'
)
returns table(touchpoint_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role text;
  v_rep uuid := auth.uid();
  v_type_org_id uuid;
  v_type_key text;
  v_contact_org_id uuid;
  v_contact_account_id uuid;
  v_account_org_id uuid;
  v_property_org_id uuid;
  v_outcome_org_id uuid;
  v_resolved_account_id uuid := p_account_id;
  v_touchpoint_id uuid;
  v_phase text := coalesce(nullif(btrim(coalesce(p_engagement_phase, '')), ''), 'follow_up');
begin
  select m.org_id, m.role into v_org_id, v_role
  from public.rpc_get_my_org() m;

  if v_org_id is null then
    raise exception 'No organization context';
  end if;
  if v_rep is null then
    raise exception 'Not authenticated';
  end if;
  if p_touchpoint_type_id is null then
    raise exception 'touchpoint_type_id is required';
  end if;
  if p_contact_id is null and p_account_id is null and p_property_id is null then
    raise exception 'At least one of contact, account, or property is required';
  end if;
  if v_phase not in ('first_touch', 'follow_up', 'visibility') then
    raise exception 'engagement_phase must be first_touch, follow_up, or visibility';
  end if;

  -- Type must be an inbound-capable communication type.
  select tt.org_id, tt.key
  into v_type_org_id, v_type_key
  from public.touchpoint_types tt
  where tt.id = p_touchpoint_type_id;
  if not found then
    raise exception 'Touchpoint type not found';
  end if;
  if v_type_org_id is not null and v_type_org_id <> v_org_id then
    raise exception 'Touchpoint type is not in your organization';
  end if;
  if v_type_key not in ('call', 'email', 'text') then
    raise exception 'Inbound touchpoints must be a call, email, or text';
  end if;

  -- Validate contact (and adopt its account when none was supplied).
  if p_contact_id is not null then
    select c.org_id, c.account_id
    into v_contact_org_id, v_contact_account_id
    from public.contacts c
    where c.id = p_contact_id;
    if v_contact_org_id is null or v_contact_org_id <> v_org_id then
      raise exception 'Contact must belong to your organization';
    end if;
    if v_resolved_account_id is null then
      v_resolved_account_id := v_contact_account_id;
    end if;
  end if;

  -- Validate property.
  if p_property_id is not null then
    select p.org_id into v_property_org_id
    from public.properties p
    where p.id = p_property_id;
    if v_property_org_id is null or v_property_org_id <> v_org_id then
      raise exception 'Property must belong to your organization';
    end if;
  end if;

  -- Validate account (explicit or contact-resolved).
  if v_resolved_account_id is not null then
    select a.org_id into v_account_org_id
    from public.accounts a
    where a.id = v_resolved_account_id;
    if v_account_org_id is null or v_account_org_id <> v_org_id then
      raise exception 'Account must belong to your organization';
    end if;
  end if;

  if p_account_id is not null
     and v_contact_account_id is not null
     and p_account_id <> v_contact_account_id then
    raise exception 'contact.account_id must match account';
  end if;

  -- Validate outcome (optional).
  if p_outcome_id is not null then
    select o.org_id into v_outcome_org_id
    from public.touchpoint_outcomes o
    where o.id = p_outcome_id;
    if v_outcome_org_id is null and not exists (
      select 1 from public.touchpoint_outcomes o
      where o.id = p_outcome_id and o.org_id is null
    ) then
      raise exception 'Outcome not found';
    end if;
    if v_outcome_org_id is not null and v_outcome_org_id <> v_org_id then
      raise exception 'Outcome is not in your organization';
    end if;
  end if;

  insert into public.touchpoints (
    org_id, rep_user_id, property_id, account_id, contact_id,
    touchpoint_type_id, outcome_id, engagement_phase, direction,
    happened_at, notes, created_by
  )
  values (
    v_org_id, v_rep, p_property_id, v_resolved_account_id, p_contact_id,
    p_touchpoint_type_id, p_outcome_id, v_phase, 'inbound',
    coalesce(p_happened_at, now()), p_notes, v_rep
  )
  returning id into v_touchpoint_id;

  -- Visibility only: intentionally no score_events and no streak updates.

  return query select v_touchpoint_id;
end;
$$;

revoke all on function public.rpc_log_inbound_touchpoint(
  uuid, uuid, uuid, uuid, uuid, text, timestamptz, text
) from public;
grant execute on function public.rpc_log_inbound_touchpoint(
  uuid, uuid, uuid, uuid, uuid, text, timestamptz, text
) to authenticated;

commit;
