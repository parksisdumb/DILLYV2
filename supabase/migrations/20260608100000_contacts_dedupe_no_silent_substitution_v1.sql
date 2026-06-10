begin;

-- Bugfix: rpc_create_contact was silently RETURNING an existing contact whenever
-- the new contact's email OR phone matched one already in the org. In commercial
-- roofing BD, reps routinely enter the same company main line (a shared
-- switchboard) or a generic info@ email for several DISTINCT people at one
-- account. Phone-based dedup then collapsed every such "new" contact into the
-- first one created at that account, so the contacts list appeared to show only
-- one person (e.g. "Lisa ...") no matter how many contacts were added.
--
-- A contact is a person. Two people who share an office phone line are still two
-- people, so we must never substitute one for the other. This recreates the
-- function to ALWAYS insert the new contact. We keep the existing return
-- signature for client compatibility, but the dedup is now advisory only:
-- `warning` is set when an active contact with the same email already exists, and
-- the newly-created row is still returned. Phone is no longer treated as an
-- identity key at all.

create or replace function public.rpc_create_contact(
  p_account_id uuid,
  p_first_name text,
  p_last_name text,
  p_title text default null,
  p_email text default null,
  p_phone text default null,
  p_decision_role text default null,
  p_priority_score numeric default 0
)
returns table(
  id uuid,
  org_id uuid,
  account_id uuid,
  full_name text,
  first_name text,
  last_name text,
  title text,
  email text,
  phone text,
  email_normalized text,
  phone_normalized text,
  decision_role text,
  priority_score numeric,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid,
  deleted_at timestamptz,
  deduped boolean,
  dedupe_reason text,
  warning text,
  warning_account_mismatch boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role text;
  v_account_org_id uuid;
  v_first_name text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last_name text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email_normalized text;
  v_phone_normalized text;
  v_row public.contacts;
  v_email_dup_exists boolean := false;
  v_warning text := null;
begin
  select m.org_id, m.role into v_org_id, v_role
  from public.rpc_get_my_org() m;

  if p_account_id is null then
    raise exception 'account_id is required';
  end if;
  if v_first_name is null then
    raise exception 'first_name is required';
  end if;
  if v_last_name is null then
    raise exception 'last_name is required';
  end if;

  v_email_normalized := case
    when v_email is null then null
    else lower(v_email)
  end;

  v_phone_normalized := case
    when v_phone is null then null
    else nullif(regexp_replace(v_phone, '\D', '', 'g'), '')
  end;

  select a.org_id
  into v_account_org_id
  from public.accounts a
  where a.id = p_account_id;

  if v_account_org_id is null then
    raise exception 'Account not found';
  end if;

  if v_account_org_id <> v_org_id then
    raise exception 'Account is not in your organization';
  end if;

  -- Advisory only: note if an active contact already shares this email. Email is
  -- a strong per-person identifier, so surface it as a heads-up — but we still
  -- create the new contact rather than silently returning the existing one.
  if v_email_normalized is not null then
    select exists (
      select 1
      from public.contacts c
      where c.org_id = v_org_id
        and c.email_normalized = v_email_normalized
        and c.deleted_at is null
    ) into v_email_dup_exists;

    if v_email_dup_exists then
      v_warning := 'A contact with this email already exists.';
    end if;
  end if;

  -- Always insert the new contact. Phone is intentionally NOT used for dedup:
  -- many distinct people share a company switchboard line.
  insert into public.contacts (
    org_id,
    account_id,
    full_name,
    first_name,
    last_name,
    title,
    email,
    phone,
    email_normalized,
    phone_normalized,
    decision_role,
    priority_score,
    created_by
  )
  values (
    v_org_id,
    p_account_id,
    concat_ws(' ', v_first_name, v_last_name),
    v_first_name,
    v_last_name,
    nullif(btrim(coalesce(p_title, '')), ''),
    v_email,
    v_phone,
    v_email_normalized,
    v_phone_normalized,
    nullif(btrim(coalesce(p_decision_role, '')), ''),
    coalesce(p_priority_score, 0),
    auth.uid()
  )
  returning * into v_row;

  return query
  select
    v_row.id,
    v_row.org_id,
    v_row.account_id,
    v_row.full_name,
    v_row.first_name,
    v_row.last_name,
    v_row.title,
    v_row.email,
    v_row.phone,
    v_row.email_normalized,
    v_row.phone_normalized,
    v_row.decision_role,
    v_row.priority_score,
    v_row.is_active,
    v_row.created_at,
    v_row.updated_at,
    v_row.created_by,
    v_row.deleted_at,
    false,            -- deduped: we always create a fresh contact now
    null::text,       -- dedupe_reason
    v_warning,        -- advisory email-duplicate heads-up (nullable)
    false;            -- warning_account_mismatch (no longer applicable)
end;
$$;

revoke all on function public.rpc_create_contact(uuid, text, text, text, text, text, text, numeric) from public;
grant execute on function public.rpc_create_contact(uuid, text, text, text, text, text, text, numeric) to authenticated;

commit;
