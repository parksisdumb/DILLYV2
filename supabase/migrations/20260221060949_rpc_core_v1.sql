-- =========================================================
-- Dilly v2 - rpc_core_v1
-- Security definer RPC functions for atomic writes
-- =========================================================

-- -------------------------
-- 1) Bootstrap: create org + roles + membership for current user
-- -------------------------
create or replace function public.rpc_bootstrap_org(p_org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_admin_role_id uuid;
  v_manager_role_id uuid;
  v_rep_role_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.orgs (name, created_by)
  values (p_org_name, auth.uid())
  returning id into v_org_id;

  -- create org-scoped roles
  insert into public.roles (org_id, key, name, created_by)
  values
    (v_org_id, 'admin', 'Admin', auth.uid()),
    (v_org_id, 'manager', 'Manager', auth.uid()),
    (v_org_id, 'rep', 'Rep', auth.uid())
  returning id into v_admin_role_id;

  -- We need the IDs explicitly; easiest is to fetch them
  select id into v_admin_role_id from public.roles where org_id = v_org_id and key = 'admin' limit 1;
  select id into v_manager_role_id from public.roles where org_id = v_org_id and key = 'manager' limit 1;
  select id into v_rep_role_id from public.roles where org_id = v_org_id and key = 'rep' limit 1;

  insert into public.memberships (org_id, user_id, role_id, created_by)
  values (v_org_id, auth.uid(), v_admin_role_id, auth.uid());

  return v_org_id;
end;
$$;

revoke all on function public.rpc_bootstrap_org(text) from public;
grant execute on function public.rpc_bootstrap_org(text) to authenticated;

-- -------------------------
-- 2) Seed global defaults (one-time helper; safe to re-run)
-- -------------------------
create or replace function public.rpc_seed_defaults()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Scope types (global defaults)
  insert into public.scope_types (org_id, key, name, sort_order)
  values
    (null, 'inspection', 'Inspection', 10),
    (null, 'repair', 'Repair', 20),
    (null, 'replacement', 'Replacement', 30),
    (null, 'service_maintenance', 'Service/Maintenance', 40),
    (null, 'new_construction', 'New Construction', 50),
    (null, 'other', 'Other/Unknown', 99)
  on conflict do nothing;

  -- Opportunity stages (global defaults)
  insert into public.opportunity_stages (org_id, key, name, sort_order, is_closed_stage)
  values
    (null, 'open_pre_inspection', 'Open / Pre-Inspection', 10, false),
    (null, 'inspection_scheduled', 'Inspection Scheduled', 20, false),
    (null, 'inspection_completed', 'Inspection Completed', 30, false),
    (null, 'bid_requested', 'Bid Requested', 40, false),
    (null, 'bid_submitted', 'Bid Submitted', 50, false),
    (null, 'decision_last_look', 'Decision / Last Look', 60, false),
    (null, 'won', 'Won', 90, true),
    (null, 'lost', 'Lost', 100, true)
  on conflict do nothing;

  -- Touchpoint types (global defaults)
  insert into public.touchpoint_types (org_id, key, name, sort_order)
  values
    (null, 'call', 'Call', 10),
    (null, 'email', 'Email', 20),
    (null, 'pop_in', 'Pop-in / Site Visit', 30)
  on conflict do nothing;

  -- Milestone types (global defaults)
  insert into public.milestone_types (org_id, key, name, sort_order)
  values
    (null, 'inspection_scheduled', 'Inspection Scheduled', 10),
    (null, 'inspection_completed', 'Inspection Completed', 20),
    (null, 'bid_requested', 'Bid Requested', 30),
    (null, 'bid_submitted', 'Bid Submitted', 40),
    (null, 'last_look_scheduled', 'Last Look Scheduled', 50),
    (null, 'last_look_completed', 'Last Look Completed', 60),
    (null, 'won', 'Won', 90),
    (null, 'lost', 'Lost', 100)
  on conflict do nothing;

  -- Lost reason defaults
  insert into public.lost_reason_types (org_id, key, name, sort_order)
  values
    (null, 'price', 'Price', 10),
    (null, 'competitor', 'Competitor', 20),
    (null, 'timing', 'Timing', 30),
    (null, 'no_decision', 'No Decision', 40),
    (null, 'no_response', 'No Response', 50),
    (null, 'relationship', 'Relationship', 60),
    (null, 'scope_change', 'Scope Change', 70),
    (null, 'capacity', 'Capacity', 80),
    (null, 'other', 'Other', 99)
  on conflict do nothing;

  -- Outcomes (global defaults) with stage/milestone mapping
  -- NOTE: We look up referenced IDs by key (global rows)
  -- This keeps the migration stable and avoids hard-coded UUIDs.
  insert into public.touchpoint_outcomes (
    org_id, touchpoint_type_id, key, name, category, sort_order,
    suggested_stage_id, creates_milestone_type_id, qualifies_opportunity
  )
  select
    null,
    null, -- shared across types initially
    o.key,
    o.name,
    o.category,
    o.sort_order,
    s.id,
    m.id,
    o.qualifies_opportunity
  from (
    values
      ('wrong_number','Wrong Number','data_hygiene',10,false,null,null),
      ('wrong_email','Wrong Email','data_hygiene',20,false,null,null),
      ('bounced','Email Bounced','data_hygiene',30,false,null,null),
      ('unreachable','Unreachable','data_hygiene',40,false,null,null),

      ('no_answer_voicemail','No Answer / Voicemail','engagement',50,false,null,null),
      ('gatekeeper','Gatekeeper','engagement',60,false,null,null),
      ('connected_conversation','Connected / Conversation','engagement',70,false,null,null),
      ('reply_received','Reply Received','engagement',80,false,null,null),
      ('dm_identified','Decision Maker Identified','engagement',90,false,null,null),
      ('referred','Referred','engagement',100,false,null,null),

      ('inspection_scheduled','Inspection Scheduled','inspection',110,true,'inspection_scheduled','inspection_scheduled'),
      ('inspection_completed','Inspection Completed','inspection',120,true,'inspection_completed','inspection_completed'),

      ('bid_requested','Bid Requested','bid',130,true,'bid_requested','bid_requested'),
      ('bid_submitted','Bid Submitted','bid',140,true,'bid_submitted','bid_submitted'),

      ('last_look_scheduled','Last Look Scheduled','decision',150,false,'decision_last_look','last_look_scheduled'),
      ('last_look_completed','Last Look Completed','decision',160,false,'decision_last_look','last_look_completed'),

      ('awaiting_decision','Awaiting Decision','decision',170,false,'decision_last_look',null),
      ('won','Won','decision',180,false,'won','won'),
      ('lost','Lost','decision',190,false,'lost','lost')
  ) as o(key,name,category,sort_order,qualifies_opportunity,suggest_stage_key,create_milestone_key)
  left join public.opportunity_stages s
    on s.org_id is null and s.key = o.suggest_stage_key
  left join public.milestone_types m
    on m.org_id is null and m.key = o.create_milestone_key
  on conflict do nothing;
end;
$$;

revoke all on function public.rpc_seed_defaults() from public;
grant execute on function public.rpc_seed_defaults() to authenticated;

-- -------------------------
-- 3) Create property + assignment (creator gets access)
-- -------------------------
create or replace function public.rpc_create_property_with_assignment(
  p_address_line1 text,
  p_city text,
  p_state text,
  p_postal_code text,
  p_address_line2 text default null,
  p_country text default 'US',
  p_primary_account_id uuid default null,
  p_primary_contact_id uuid default null,
  p_notes text default null
)
returns public.properties
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_property public.properties;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  v_org_id := public.current_org_id();
  if v_org_id is null then
    raise exception 'No org membership found for user';
  end if;

  insert into public.properties (
    org_id, address_line1, address_line2, city, state, postal_code, country,
    primary_account_id, primary_contact_id, notes, created_by
  )
  values (
    v_org_id, p_address_line1, p_address_line2, p_city, p_state, p_postal_code, p_country,
    p_primary_account_id, p_primary_contact_id, p_notes, auth.uid()
  )
  returning * into v_property;

  insert into public.property_assignments (org_id, property_id, user_id, assignment_role, created_by)
  values (v_org_id, v_property.id, auth.uid(), 'assigned_rep', auth.uid())
  on conflict (property_id, user_id) do nothing;

  return v_property;
end;
$$;

revoke all on function public.rpc_create_property_with_assignment(
  text, text, text, text, text, text, uuid, uuid, text
) from public;

grant execute on function public.rpc_create_property_with_assignment(
  text, text, text, text, text, text, uuid, uuid, text
) to authenticated;

-- -------------------------
-- 4) Atomic touchpoint write path (touchpoint + milestone + next_action + scoring)
-- -------------------------
create or replace function public.rpc_create_touchpoint_and_side_effects(
  p_property_id uuid,
  p_touchpoint_type_key text,
  p_outcome_key text default null,
  p_opportunity_id uuid default null,
  p_notes text default null,
  p_happened_at timestamptz default now(),

  -- follow-up creation (optional)
  p_create_next_action boolean default false,
  p_next_action_due_at timestamptz default null,
  p_next_action_assigned_user_id uuid default null,
  p_next_action_recommended_type_key text default null,
  p_next_action_notes text default null,

  -- complete an existing next action (optional)
  p_complete_next_action_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_touchpoint_type_id uuid;
  v_outcome_id uuid;
  v_outcome record;

  v_touchpoint public.touchpoints;
  v_milestone_id uuid;
  v_suggested_stage_id uuid;
  v_qualifies_opportunity boolean;

  v_next_action_id uuid;
  v_next_action_recommended_type_id uuid;

  v_points_total int := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  v_org_id := public.current_org_id();
  if v_org_id is null then
    raise exception 'No org membership found for user';
  end if;

  if not public.has_property_access(v_org_id, p_property_id) then
    raise exception 'No access to property';
  end if;

  if p_opportunity_id is not null and not public.has_opportunity_access(v_org_id, p_opportunity_id) then
    raise exception 'No access to opportunity';
  end if;

  -- Resolve touchpoint type: prefer org-specific row, fallback to global
  select id into v_touchpoint_type_id
  from public.touchpoint_types
  where key = p_touchpoint_type_key
    and (org_id = v_org_id or org_id is null)
  order by (org_id is null) asc
  limit 1;

  if v_touchpoint_type_id is null then
    raise exception 'Unknown touchpoint type key: %', p_touchpoint_type_key;
  end if;

  -- Resolve outcome similarly (if provided)
  if p_outcome_key is not null then
    select *
    into v_outcome
    from public.touchpoint_outcomes
    where key = p_outcome_key
      and (org_id = v_org_id or org_id is null)
    order by (org_id is null) asc
    limit 1;

    v_outcome_id := v_outcome.id;
    v_suggested_stage_id := v_outcome.suggested_stage_id;
    v_qualifies_opportunity := v_outcome.qualifies_opportunity;
  end if;

  -- Insert touchpoint
  insert into public.touchpoints (
    org_id, rep_user_id, property_id, opportunity_id,
    touchpoint_type_id, outcome_id, happened_at, notes, created_by
  )
  values (
    v_org_id, auth.uid(), p_property_id, p_opportunity_id,
    v_touchpoint_type_id, v_outcome_id, p_happened_at, p_notes, auth.uid()
  )
  returning * into v_touchpoint;

  -- Create milestone if mapped and opportunity is present
  if p_opportunity_id is not null and v_outcome_id is not null and v_outcome.creates_milestone_type_id is not null then
    insert into public.opportunity_milestones (
      org_id, opportunity_id, milestone_type_id, happened_at, source_touchpoint_id, created_by
    )
    values (
      v_org_id, p_opportunity_id, v_outcome.creates_milestone_type_id, p_happened_at, v_touchpoint.id, auth.uid()
    )
    returning id into v_milestone_id;
  end if;

  -- Complete a next action if requested
  if p_complete_next_action_id is not null then
    update public.next_actions
    set status = 'completed',
        completed_by_touchpoint_id = v_touchpoint.id,
        updated_at = now()
    where id = p_complete_next_action_id
      and org_id = v_org_id
      and (assigned_user_id = auth.uid() or public.is_manager(v_org_id));
  end if;

  -- Create a next action if requested
  if p_create_next_action then
    if p_next_action_assigned_user_id is null then
      p_next_action_assigned_user_id := auth.uid();
    end if;

    if p_next_action_due_at is null then
      raise exception 'next_action_due_at required when create_next_action=true';
    end if;

    if p_next_action_recommended_type_key is not null then
      select id into v_next_action_recommended_type_id
      from public.touchpoint_types
      where key = p_next_action_recommended_type_key
        and (org_id = v_org_id or org_id is null)
      order by (org_id is null) asc
      limit 1;
    end if;

    insert into public.next_actions (
      org_id, property_id, opportunity_id,
      assigned_user_id, recommended_touchpoint_type_id,
      due_at, status, notes,
      created_from_touchpoint_id, created_by
    )
    values (
      v_org_id, p_property_id, p_opportunity_id,
      p_next_action_assigned_user_id, v_next_action_recommended_type_id,
      p_next_action_due_at, 'open', p_next_action_notes,
      v_touchpoint.id, auth.uid()
    )
    returning id into v_next_action_id;
  end if;

  -- Scoring: award points from score_rules that match this touchpoint/outcome/milestone
  insert into public.score_events (org_id, user_id, touchpoint_id, milestone_id, points, reason, created_by)
  select
    v_org_id,
    auth.uid(),
    v_touchpoint.id,
    v_milestone_id,
    sr.points,
    'rule_award',
    auth.uid()
  from public.score_rules sr
  where (sr.org_id = v_org_id or sr.org_id is null)
    and (
      (sr.touchpoint_type_id is not null and sr.touchpoint_type_id = v_touchpoint_type_id)
      or (sr.outcome_id is not null and sr.outcome_id = v_outcome_id)
      or (sr.milestone_type_id is not null and v_outcome.creates_milestone_type_id is not null and sr.milestone_type_id = v_outcome.creates_milestone_type_id)
    );

  -- Return structured result
  return jsonb_build_object(
    'touchpoint', to_jsonb(v_touchpoint),
    'created_milestone_id', v_milestone_id,
    'suggested_stage_id', v_suggested_stage_id,
    'qualifies_opportunity', coalesce(v_qualifies_opportunity, false),
    'created_next_action_id', v_next_action_id
  );
end;
$$;

revoke all on function public.rpc_create_touchpoint_and_side_effects(
  uuid, text, text, uuid, text, timestamptz,
  boolean, timestamptz, uuid, text, text,
  uuid
) from public;

grant execute on function public.rpc_create_touchpoint_and_side_effects(
  uuid, text, text, uuid, text, timestamptz,
  boolean, timestamptz, uuid, text, text,
  uuid
) to authenticated;

-- -------------------------
-- 5) Manager edit touchpoint WITH revision audit
-- -------------------------
create or replace function public.rpc_manager_update_touchpoint_with_revision(
  p_touchpoint_id uuid,
  p_reason text,
  p_happened_at timestamptz default null,
  p_outcome_key text default null,
  p_notes text default null
)
returns public.touchpoints
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_touchpoint public.touchpoints;
  v_outcome_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select org_id into v_org_id from public.touchpoints where id = p_touchpoint_id;
  if v_org_id is null then
    raise exception 'Touchpoint not found';
  end if;

  if not public.is_manager(v_org_id) then
    raise exception 'Manager role required';
  end if;

  select to_jsonb(t) into v_before from public.touchpoints t where t.id = p_touchpoint_id;

  if p_outcome_key is not null then
    select id into v_outcome_id
    from public.touchpoint_outcomes
    where key = p_outcome_key
      and (org_id = v_org_id or org_id is null)
    order by (org_id is null) asc
    limit 1;
  end if;

  update public.touchpoints
  set
    happened_at = coalesce(p_happened_at, happened_at),
    outcome_id = coalesce(v_outcome_id, outcome_id),
    notes = coalesce(p_notes, notes),
    updated_at = now()
  where id = p_touchpoint_id
  returning * into v_touchpoint;

  select to_jsonb(v_touchpoint) into v_after;

  insert into public.touchpoint_revisions (org_id, touchpoint_id, revised_by, reason, before, after)
  values (v_org_id, p_touchpoint_id, auth.uid(), p_reason, v_before, v_after);

  return v_touchpoint;
end;
$$;

revoke all on function public.rpc_manager_update_touchpoint_with_revision(
  uuid, text, timestamptz, text, text
) from public;

grant execute on function public.rpc_manager_update_touchpoint_with_revision(
  uuid, text, timestamptz, text, text
) to authenticated;