begin;

alter table if exists public.contacts
  add column if not exists email_normalized text;

alter table if exists public.contacts
  add column if not exists phone_normalized text;

update public.contacts
set email_normalized = lower(btrim(email))
where email is not null;

update public.contacts
set phone_normalized = nullif(regexp_replace(phone, '\D', '', 'g'), '')
where phone is not null;

create index if not exists contacts_org_email_normalized_idx
  on public.contacts (org_id, email_normalized)
  where email_normalized is not null;

create index if not exists contacts_org_phone_normalized_idx
  on public.contacts (org_id, phone_normalized)
  where phone_normalized is not null;

drop function if exists public.rpc_create_contact(
  uuid, text, text, text, text, text, text, numeric
);

create function public.rpc_create_contact(
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
  v_existing public.contacts;
  v_deduped boolean := false;
  v_dedupe_reason text := null;
  v_warning text := null;
  v_warning_account_mismatch boolean := false;
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

  if v_email_normalized is not null then
    select c.*
    into v_existing
    from public.contacts c
    where c.org_id = v_org_id
      and c.email_normalized = v_email_normalized
      and c.deleted_at is null
    order by c.updated_at desc nulls last, c.created_at desc
    limit 1;

    if found then
      v_row := v_existing;
      v_deduped := true;
      v_dedupe_reason := 'email';
    end if;
  end if;

  if not v_deduped and v_phone_normalized is not null then
    select c.*
    into v_existing
    from public.contacts c
    where c.org_id = v_org_id
      and c.phone_normalized = v_phone_normalized
      and c.deleted_at is null
    order by c.updated_at desc nulls last, c.created_at desc
    limit 1;

    if found then
      v_row := v_existing;
      v_deduped := true;
      v_dedupe_reason := 'phone';
    end if;
  end if;

  if not v_deduped then
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
  end if;

  if v_deduped and v_row.account_id is distinct from p_account_id then
    v_warning_account_mismatch := true;
    v_warning := 'Existing contact matched under a different account. Use the existing contact account.';
  end if;

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
    v_deduped,
    v_dedupe_reason,
    v_warning,
    v_warning_account_mismatch;
end;
$$;

revoke all on function public.rpc_create_contact(uuid, text, text, text, text, text, text, numeric) from public;
grant execute on function public.rpc_create_contact(uuid, text, text, text, text, text, text, numeric) to authenticated;

commit;
