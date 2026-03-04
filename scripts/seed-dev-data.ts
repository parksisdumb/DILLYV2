import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

const DEV_ORG_NAME = "Dilly Dev Org";
const DEV_PASSWORD = "devpassword123!";

const DEV_USERS = [
  { email: "admin@dilly.dev", role: "admin" as const },
  { email: "manager@dilly.dev", role: "manager" as const },
  { email: "rep1@dilly.dev", role: "rep" as const },
  { email: "rep2@dilly.dev", role: "rep" as const },
];

type TypeKeyRow = {
  id: string;
  key: string;
};

type AccountRow = {
  id: string;
  name: string;
};

type ContactRow = {
  id: string;
  email: string | null;
  account_id: string;
  full_name: string | null;
};

type PropertyRow = {
  id: string;
  external_ref: string | null;
  primary_account_id: string | null;
  primary_contact_id: string | null;
};

type OpportunityRow = {
  id: string;
  title: string | null;
  property_id: string;
  account_id: string | null;
  primary_contact_id: string | null;
};

type TouchpointRow = {
  id: string;
  notes: string | null;
};

type UserByEmail = {
  id: string;
  email: string;
};

if (!SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY) in env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message && error.message.trim().length > 0) {
      return error.message;
    }
    try {
      const asObj = Object.fromEntries(
        Object.entries(error as unknown as Record<string, unknown>),
      );
      return JSON.stringify({ name: error.name, ...asObj });
    } catch {
      return String(error);
    }
  }
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`Expected ${label} to be a non-empty string`);
  }
  return value;
}

function noteFor(prefix: string, idx: number): string {
  return `${prefix}-${String(idx).padStart(2, "0")}`;
}

async function listUsersByEmail(
  client: SupabaseClient,
  emails: string[],
): Promise<Map<string, UserByEmail>> {
  const wanted = new Set(emails.map((e) => e.toLowerCase()));
  const out = new Map<string, UserByEmail>();
  const perPage = 200;
  let page = 1;

  while (true) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    for (const user of data.users) {
      const email = (user.email || "").toLowerCase();
      if (wanted.has(email) && user.id) {
        out.set(email, { id: user.id, email });
      }
    }

    if (data.users.length < perPage || out.size === wanted.size) break;
    page++;
  }

  return out;
}

async function tryBootstrapOrgViaRpc(): Promise<string | null> {
  try {
    const sessionClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: signInError } = await sessionClient.auth.signInWithPassword({
      email: "admin@dilly.dev",
      password: DEV_PASSWORD,
    });

    if (signInError) {
      return null;
    }

    const { data, error } = await sessionClient.rpc("rpc_bootstrap_org", {
      p_org_name: DEV_ORG_NAME,
    });

    await sessionClient.auth.signOut();

    if (error) return null;

    if (typeof data === "string" && data) return data;
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === "string") {
      return data[0];
    }

    return null;
  } catch {
    return null;
  }
}

async function ensureDevOrg(
  client: SupabaseClient,
  adminUserId: string,
): Promise<string> {
  const { data: existing, error: existingError } = await client
    .from("orgs")
    .select("id, created_at")
    .eq("name", DEV_ORG_NAME)
    .order("created_at", { ascending: true });

  if (existingError) throw existingError;

  if (existing && existing.length > 0) {
    if (existing.length > 1) {
      console.log(
        `WARN: Found ${existing.length} org rows named "${DEV_ORG_NAME}". Reusing oldest: ${existing[0].id}`,
      );
    }
    return existing[0].id;
  }

  const rpcOrgId = await tryBootstrapOrgViaRpc();
  if (rpcOrgId) {
    return rpcOrgId;
  }

  const { data: inserted, error: insertError } = await client
    .from("orgs")
    .insert({ name: DEV_ORG_NAME, created_by: adminUserId })
    .select("id")
    .single();

  if (insertError) throw insertError;
  return inserted.id;
}

async function ensureOrgUsers(
  client: SupabaseClient,
  orgId: string,
  users: Map<string, UserByEmail>,
): Promise<void> {
  const rows = DEV_USERS.map((u) => {
    const found = users.get(u.email.toLowerCase());
    if (!found) throw new Error(`Missing seeded auth user: ${u.email}`);

    return {
      org_id: orgId,
      user_id: found.id,
      role: u.role,
    };
  });

  const { error } = await client.from("org_users").upsert(rows, {
    onConflict: "user_id",
    ignoreDuplicates: false,
  });

  if (error) throw error;
}

async function upsertKeyRows(
  client: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  const { error } = await client.from(table).upsert(rows, {
    onConflict: "org_id,key",
    ignoreDuplicates: false,
  });
  if (error) throw error;
}

async function fetchKeyIdMap(
  client: SupabaseClient,
  table: string,
  orgId: string,
  keys: string[],
): Promise<Map<string, string>> {
  const { data, error } = await client
    .from(table)
    .select("id,key")
    .eq("org_id", orgId)
    .in("key", keys);

  if (error) throw error;

  const map = new Map<string, string>();
  for (const row of (data ?? []) as TypeKeyRow[]) {
    if (row.key) map.set(row.key, row.id);
  }
  return map;
}

async function ensureTypeTables(
  client: SupabaseClient,
  orgId: string,
  createdBy: string,
): Promise<{
  scopeTypes: Map<string, string>;
  stages: Map<string, string>;
  touchpointTypes: Map<string, string>;
  touchpointOutcomes: Map<string, string>;
  milestoneTypes: Map<string, string>;
  lostReasons: Map<string, string>;
}> {
  const scopeRows = [
    { org_id: orgId, key: "inspection", name: "Inspection", sort_order: 10, created_by: createdBy },
    { org_id: orgId, key: "repair", name: "Repair", sort_order: 20, created_by: createdBy },
    { org_id: orgId, key: "replacement", name: "Replacement", sort_order: 30, created_by: createdBy },
    { org_id: orgId, key: "maintenance", name: "Maintenance", sort_order: 40, created_by: createdBy },
  ];
  await upsertKeyRows(client, "scope_types", scopeRows);

  const stageRows = [
    { org_id: orgId, key: "open", name: "Open", sort_order: 10, is_closed_stage: false, created_by: createdBy },
    { org_id: orgId, key: "inspection_scheduled", name: "Inspection Scheduled", sort_order: 20, is_closed_stage: false, created_by: createdBy },
    { org_id: orgId, key: "proposal_sent", name: "Proposal Sent", sort_order: 30, is_closed_stage: false, created_by: createdBy },
    { org_id: orgId, key: "won", name: "Won", sort_order: 90, is_closed_stage: true, created_by: createdBy },
    { org_id: orgId, key: "lost", name: "Lost", sort_order: 100, is_closed_stage: true, created_by: createdBy },
  ];
  await upsertKeyRows(client, "opportunity_stages", stageRows);

  const touchpointTypeRows = [
    { org_id: orgId, key: "call", name: "Call", sort_order: 10, is_outreach: true, created_by: createdBy },
    { org_id: orgId, key: "email", name: "Email", sort_order: 20, is_outreach: true, created_by: createdBy },
    { org_id: orgId, key: "text", name: "Text", sort_order: 30, is_outreach: true, created_by: createdBy },
    { org_id: orgId, key: "door_knock", name: "Door Knock", sort_order: 40, is_outreach: true, created_by: createdBy },
    { org_id: orgId, key: "site_visit", name: "Site Visit", sort_order: 50, is_outreach: true, created_by: createdBy },
    { org_id: orgId, key: "inspection", name: "Inspection", sort_order: 60, is_outreach: false, created_by: createdBy },
    { org_id: orgId, key: "bid_sent", name: "Bid Sent", sort_order: 70, is_outreach: false, created_by: createdBy },
    { org_id: orgId, key: "meeting", name: "Meeting", sort_order: 80, is_outreach: false, created_by: createdBy },
    { org_id: orgId, key: "note", name: "Note", sort_order: 90, is_outreach: false, created_by: createdBy },
  ];
  await upsertKeyRows(client, "touchpoint_types", touchpointTypeRows);

  const milestoneRows = [
    { org_id: orgId, key: "inspection_scheduled", name: "Inspection Scheduled", sort_order: 10, default_points: 5, created_by: createdBy },
    { org_id: orgId, key: "bid_submitted", name: "Bid Submitted", sort_order: 20, default_points: 8, created_by: createdBy },
    { org_id: orgId, key: "contract_signed", name: "Contract Signed", sort_order: 30, default_points: 12, created_by: createdBy },
  ];
  await upsertKeyRows(client, "milestone_types", milestoneRows);

  const lostReasonRows = [
    { org_id: orgId, key: "price", name: "Price", sort_order: 10, created_by: createdBy },
    { org_id: orgId, key: "competitor", name: "Competitor", sort_order: 20, created_by: createdBy },
    { org_id: orgId, key: "timing", name: "Timing", sort_order: 30, created_by: createdBy },
    { org_id: orgId, key: "other", name: "Other", sort_order: 40, created_by: createdBy },
  ];
  await upsertKeyRows(client, "lost_reason_types", lostReasonRows);

  const touchpointTypeMap = await fetchKeyIdMap(
    client,
    "touchpoint_types",
    orgId,
    touchpointTypeRows.map((r) => assertString(r.key, "touchpoint type key")),
  );

  const outcomeRows = [
    {
      org_id: orgId,
      key: "connected",
      name: "Connected",
      category: "engagement",
      sort_order: 10,
      touchpoint_type_id: touchpointTypeMap.get("call") ?? null,
      created_by: createdBy,
    },
    {
      org_id: orgId,
      key: "no_answer",
      name: "No Answer",
      category: "engagement",
      sort_order: 20,
      touchpoint_type_id: touchpointTypeMap.get("call") ?? null,
      created_by: createdBy,
    },
    {
      org_id: orgId,
      key: "follow_up_sent",
      name: "Follow Up Sent",
      category: "engagement",
      sort_order: 30,
      touchpoint_type_id: touchpointTypeMap.get("email") ?? null,
      created_by: createdBy,
    },
    {
      org_id: orgId,
      key: "inspection_set",
      name: "Inspection Set",
      category: "inspection",
      sort_order: 40,
      touchpoint_type_id: touchpointTypeMap.get("site_visit") ?? null,
      created_by: createdBy,
    },
  ];
  await upsertKeyRows(client, "touchpoint_outcomes", outcomeRows);

  return {
    scopeTypes: await fetchKeyIdMap(client, "scope_types", orgId, scopeRows.map((r) => assertString(r.key, "scope key"))),
    stages: await fetchKeyIdMap(client, "opportunity_stages", orgId, stageRows.map((r) => assertString(r.key, "stage key"))),
    touchpointTypes: touchpointTypeMap,
    touchpointOutcomes: await fetchKeyIdMap(client, "touchpoint_outcomes", orgId, outcomeRows.map((r) => assertString(r.key, "outcome key"))),
    milestoneTypes: await fetchKeyIdMap(client, "milestone_types", orgId, milestoneRows.map((r) => assertString(r.key, "milestone key"))),
    lostReasons: await fetchKeyIdMap(client, "lost_reason_types", orgId, lostReasonRows.map((r) => assertString(r.key, "lost reason key"))),
  };
}

async function ensureAccounts(
  client: SupabaseClient,
  orgId: string,
  createdBy: string,
): Promise<AccountRow[]> {
  const specs = Array.from({ length: 10 }, (_, i) => ({
    name: `Seed Account ${String(i + 1).padStart(2, "0")}`,
    account_type: i % 2 === 0 ? "owner" : "property_manager",
    notes: `seed-account-${String(i + 1).padStart(2, "0")}`,
  }));

  const names = specs.map((s) => s.name);
  const { data: existing, error: existingError } = await client
    .from("accounts")
    .select("id,name")
    .eq("org_id", orgId)
    .in("name", names);

  if (existingError) throw existingError;

  const existingNames = new Set((existing ?? []).map((row) => row.name));
  const missing = specs
    .filter((s) => !existingNames.has(s.name))
    .map((s) => ({
      org_id: orgId,
      name: s.name,
      account_type: s.account_type,
      notes: s.notes,
      created_by: createdBy,
    }));

  if (missing.length > 0) {
    const { error: insertError } = await client.from("accounts").insert(missing);
    if (insertError) throw insertError;
  }

  const { data: rows, error: fetchError } = await client
    .from("accounts")
    .select("id,name")
    .eq("org_id", orgId)
    .in("name", names);
  if (fetchError) throw fetchError;

  return (rows ?? []) as AccountRow[];
}

async function ensureContacts(
  client: SupabaseClient,
  orgId: string,
  createdBy: string,
  accounts: AccountRow[],
): Promise<ContactRow[]> {
  const accountIds = accounts.map((a) => a.id);
  if (accountIds.length === 0) {
    throw new Error("Cannot seed contacts without at least one account.");
  }

  const specs = Array.from({ length: 25 }, (_, i) => {
    const idx = i + 1;
    const firstName = `Contact${String(idx).padStart(2, "0")}`;
    const lastName = "Seed";
    const accountId = accountIds[i % accountIds.length];
    if (!accountId) {
      throw new Error(`Missing account id for contact seed index ${idx}`);
    }
    return {
      email: `contact${String(idx).padStart(2, "0")}@dilly.dev`,
      full_name: `${firstName} ${lastName}`,
      first_name: firstName,
      last_name: lastName,
      title: idx % 3 === 0 ? "Facilities Manager" : "Owner Rep",
      phone: `555-010${String(idx % 10)}`,
      decision_role: idx % 2 === 0 ? "decision_maker" : "influencer",
      priority_score: Number((idx % 7) + 1),
      account_id: accountId,
    };
  });

  const emails = specs.map((s) => s.email);
  const { data: existing, error: existingError } = await client
    .from("contacts")
    .select("id,email,account_id,full_name")
    .eq("org_id", orgId)
    .in("email", emails);
  if (existingError) throw existingError;

  const existingEmails = new Set((existing ?? []).map((row) => (row.email || "").toLowerCase()));
  const missing = specs
    .filter((s) => !existingEmails.has(s.email.toLowerCase()))
    .map((s) => ({
      org_id: orgId,
      account_id: s.account_id,
      full_name: s.full_name,
      first_name: s.first_name,
      last_name: s.last_name,
      title: s.title,
      email: s.email,
      phone: s.phone,
      decision_role: s.decision_role,
      priority_score: s.priority_score,
      created_by: createdBy,
    }));

  if (missing.length > 0) {
    const { error: insertError } = await client.from("contacts").insert(missing);
    if (insertError) throw insertError;
  }

  const { data: rows, error: fetchError } = await client
    .from("contacts")
    .select("id,email,account_id,full_name")
    .eq("org_id", orgId)
    .in("email", emails);
  if (fetchError) throw fetchError;

  return (rows ?? []) as ContactRow[];
}

async function ensureProperties(
  client: SupabaseClient,
  orgId: string,
  createdBy: string,
  accounts: AccountRow[],
  contacts: ContactRow[],
): Promise<PropertyRow[]> {
  const accountIds = accounts.map((a) => a.id);
  const contactsByAccount = new Map<string, ContactRow[]>();
  for (const contact of contacts) {
    const list = contactsByAccount.get(contact.account_id) ?? [];
    list.push(contact);
    contactsByAccount.set(contact.account_id, list);
  }

  const specs = Array.from({ length: 15 }, (_, i) => {
    const idx = i + 1;
    const primaryAccountId = accountIds[i % accountIds.length] ?? null;
    const accountContacts = primaryAccountId ? (contactsByAccount.get(primaryAccountId) ?? []) : [];
    const primaryContactId =
      accountContacts.length > 0 ? accountContacts[i % accountContacts.length]?.id ?? null : null;

    return {
      external_ref: `seed-property-${String(idx).padStart(2, "0")}`,
      address_line1: `${1000 + idx} Seed St`,
      city: idx % 2 === 0 ? "Austin" : "Dallas",
      state: "TX",
      postal_code: `75${String(100 + idx).slice(-3)}`,
      country: "US",
      notes: `Seed property ${idx}`,
      primary_account_id: primaryAccountId,
      primary_contact_id: primaryContactId,
    };
  });

  const refs = specs.map((s) => s.external_ref);
  const { data: existing, error: existingError } = await client
    .from("properties")
    .select("id,external_ref,primary_account_id,primary_contact_id")
    .eq("org_id", orgId)
    .in("external_ref", refs);
  if (existingError) throw existingError;

  const existingRefs = new Set((existing ?? []).map((row) => row.external_ref));
  const missing = specs
    .filter((s) => !existingRefs.has(s.external_ref))
    .map((s) => ({
      org_id: orgId,
      external_ref: s.external_ref,
      address_line1: s.address_line1,
      city: s.city,
      state: s.state,
      postal_code: s.postal_code,
      country: s.country,
      notes: s.notes,
      primary_account_id: s.primary_account_id,
      primary_contact_id: s.primary_contact_id,
      created_by: createdBy,
    }));

  if (missing.length > 0) {
    const { error: insertError } = await client.from("properties").insert(missing);
    if (insertError) throw insertError;
  }

  const { data: rows, error: fetchError } = await client
    .from("properties")
    .select("id,external_ref,primary_account_id,primary_contact_id")
    .eq("org_id", orgId)
    .in("external_ref", refs);
  if (fetchError) throw fetchError;
  const properties = (rows ?? []) as PropertyRow[];

  const propertyByRef = new Map(
    properties
      .filter((p) => p.external_ref)
      .map((p) => [p.external_ref as string, p]),
  );

  for (const spec of specs) {
    const property = propertyByRef.get(spec.external_ref);
    if (!property) continue;

    const patch: Record<string, unknown> = {};
    if (!property.primary_account_id && spec.primary_account_id) {
      patch.primary_account_id = spec.primary_account_id;
    }
    if (!property.primary_contact_id && spec.primary_contact_id) {
      patch.primary_contact_id = spec.primary_contact_id;
    }

    if (Object.keys(patch).length === 0) continue;

    const { error: updateError } = await client
      .from("properties")
      .update(patch)
      .eq("id", property.id)
      .eq("org_id", orgId);
    if (updateError) throw updateError;
  }

  const { data: refreshed, error: refreshError } = await client
    .from("properties")
    .select("id,external_ref,primary_account_id,primary_contact_id")
    .eq("org_id", orgId)
    .in("external_ref", refs);
  if (refreshError) throw refreshError;

  return (refreshed ?? []) as PropertyRow[];
}

async function ensurePropertyAssignments(
  client: SupabaseClient,
  orgId: string,
  createdBy: string,
  properties: PropertyRow[],
  rep1Id: string,
  rep2Id: string,
): Promise<void> {
  const rows = properties.flatMap((p, i) => {
    const primaryRep = i % 2 === 0 ? rep1Id : rep2Id;
    const secondaryRep = i % 2 === 0 ? rep2Id : rep1Id;
    return [
      {
        org_id: orgId,
        property_id: p.id,
        user_id: primaryRep,
        assignment_role: "assigned_rep",
        created_by: createdBy,
      },
      {
        org_id: orgId,
        property_id: p.id,
        user_id: secondaryRep,
        assignment_role: "viewer",
        created_by: createdBy,
      },
    ];
  });

  const { error } = await client.from("property_assignments").upsert(rows, {
    onConflict: "property_id,user_id",
    ignoreDuplicates: false,
  });
  if (error) throw error;
}

async function ensurePropertyLinks(
  client: SupabaseClient,
  orgId: string,
  createdBy: string,
  properties: PropertyRow[],
): Promise<void> {
  const propertyAccountRows = properties
    .filter((p) => p.primary_account_id)
    .map((p) => ({
      org_id: orgId,
      property_id: p.id,
      account_id: p.primary_account_id as string,
      relationship_type: "property_manager",
      is_primary: true,
      active: true,
      starts_on: null,
      ends_on: null,
      created_by: createdBy,
    }));

  if (propertyAccountRows.length > 0) {
    for (const row of propertyAccountRows) {
      const { data: exists, error: existsError } = await client
        .from("property_accounts")
        .select("id,is_primary,active")
        .eq("org_id", orgId)
        .eq("property_id", row.property_id)
        .eq("account_id", row.account_id)
        .eq("relationship_type", row.relationship_type)
        .is("starts_on", null)
        .limit(1);
      if (existsError) throw existsError;

      if (exists && exists.length > 0) {
        const { error: updateError } = await client
          .from("property_accounts")
          .update({ is_primary: true, active: true })
          .eq("id", exists[0].id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await client.from("property_accounts").insert(row);
        if (insertError) throw insertError;
      }
    }
  }

  const propertyContactRows = properties
    .filter((p) => p.primary_contact_id)
    .map((p) => ({
      org_id: orgId,
      property_id: p.id,
      contact_id: p.primary_contact_id as string,
      role_category: "decision_maker",
      role_label: "Primary Contact",
      priority_rank: 1,
      is_primary: true,
      active: true,
      created_by: createdBy,
    }));

  if (propertyContactRows.length > 0) {
    const { error } = await client.from("property_contacts").upsert(propertyContactRows, {
      onConflict: "property_id,contact_id,role_category",
      ignoreDuplicates: false,
    });
    if (error) throw error;
  }
}

async function ensureOpportunities(
  client: SupabaseClient,
  orgId: string,
  createdBy: string,
  properties: PropertyRow[],
  scopeTypeIds: Map<string, string>,
  stageIds: Map<string, string>,
): Promise<OpportunityRow[]> {
  const scopeKeys = ["inspection", "repair", "replacement", "maintenance"];
  const stageKeys = ["open", "inspection_scheduled", "proposal_sent", "open"];

  const specs = Array.from({ length: 20 }, (_, i) => {
    const idx = i + 1;
    const property = properties[i % properties.length];
    const scopeKey = scopeKeys[i % scopeKeys.length];
    const stageKey = stageKeys[i % stageKeys.length];
    const scopeTypeId = scopeTypeIds.get(scopeKey);
    const stageId = stageIds.get(stageKey);
    if (!scopeTypeId || !stageId) {
      throw new Error(`Missing scope/stage ids for opportunity seed (${scopeKey}, ${stageKey})`);
    }

    return {
      title: `Seed Opportunity ${String(idx).padStart(2, "0")}`,
      property_id: property.id,
      scope_type_id: scopeTypeId,
      stage_id: stageId,
      status: "open",
      estimated_value: 10000 + idx * 500,
      created_reason: "manual_seed",
      account_id: property.primary_account_id,
      primary_contact_id: property.primary_contact_id,
    };
  });

  const titles = specs.map((s) => s.title);
  const { data: existing, error: existingError } = await client
    .from("opportunities")
    .select("id,title")
    .eq("org_id", orgId)
    .in("title", titles);
  if (existingError) throw existingError;

  const existingTitles = new Set((existing ?? []).map((row) => row.title));
  const missing = specs
    .filter((s) => !existingTitles.has(s.title))
    .map((s) => ({
      org_id: orgId,
      title: s.title,
      property_id: s.property_id,
      scope_type_id: s.scope_type_id,
      stage_id: s.stage_id,
      status: s.status,
      estimated_value: s.estimated_value,
      created_reason: s.created_reason,
      account_id: s.account_id,
      primary_contact_id: s.primary_contact_id,
      created_by: createdBy,
    }));

  if (missing.length > 0) {
    const { error: insertError } = await client.from("opportunities").insert(missing);
    if (insertError) throw insertError;
  }

  const { data: rows, error: fetchError } = await client
    .from("opportunities")
    .select("id,title,property_id,account_id,primary_contact_id")
    .eq("org_id", orgId)
    .in("title", titles);
  if (fetchError) throw fetchError;
  const opportunities = (rows ?? []) as OpportunityRow[];
  const opportunityByTitle = new Map(
    opportunities
      .filter((o) => o.title)
      .map((o) => [o.title as string, o]),
  );

  for (const spec of specs) {
    const opportunity = opportunityByTitle.get(spec.title);
    if (!opportunity) continue;

    const patch: Record<string, unknown> = {};
    if (!opportunity.account_id && spec.account_id) {
      patch.account_id = spec.account_id;
    }
    if (!opportunity.primary_contact_id && spec.primary_contact_id) {
      patch.primary_contact_id = spec.primary_contact_id;
    }
    if (Object.keys(patch).length === 0) continue;

    const { error: updateError } = await client
      .from("opportunities")
      .update(patch)
      .eq("id", opportunity.id)
      .eq("org_id", orgId);
    if (updateError) throw updateError;
  }

  const { data: refreshed, error: refreshError } = await client
    .from("opportunities")
    .select("id,title,property_id,account_id,primary_contact_id")
    .eq("org_id", orgId)
    .in("title", titles);
  if (refreshError) throw refreshError;

  return (refreshed ?? []) as OpportunityRow[];
}

async function ensureOpportunityAssignments(
  client: SupabaseClient,
  orgId: string,
  createdBy: string,
  opportunities: OpportunityRow[],
  rep1Id: string,
  rep2Id: string,
): Promise<void> {
  const rows = opportunities.flatMap((opp, i) => {
    const primaryRep = i % 2 === 0 ? rep1Id : rep2Id;
    const collaborator = i % 3 === 0 ? (primaryRep === rep1Id ? rep2Id : rep1Id) : null;

    const base = [
      {
        org_id: orgId,
        opportunity_id: opp.id,
        user_id: primaryRep,
        assignment_role: "primary_rep",
        is_primary: true,
        created_by: createdBy,
      },
    ];

    if (collaborator) {
      base.push({
        org_id: orgId,
        opportunity_id: opp.id,
        user_id: collaborator,
        assignment_role: "sales_support",
        is_primary: false,
        created_by: createdBy,
      });
    }

    return base;
  });

  const { error } = await client.from("opportunity_assignments").upsert(rows, {
    onConflict: "opportunity_id,user_id",
    ignoreDuplicates: false,
  });
  if (error) throw error;
}

async function ensureTouchpoints(
  client: SupabaseClient,
  orgId: string,
  createdBy: string,
  properties: PropertyRow[],
  contacts: ContactRow[],
  opportunities: OpportunityRow[],
  touchpointTypeIds: Map<string, string>,
  touchpointOutcomeIds: Map<string, string>,
  rep1Id: string,
  rep2Id: string,
): Promise<TouchpointRow[]> {
  const propertyById = new Map(properties.map((p) => [p.id, p]));
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const contactIds = contacts.map((c) => c.id);
  const markers = Array.from({ length: 40 }, (_, i) => noteFor("seed-touchpoint", i + 1));

  const { data: existing, error: existingError } = await client
    .from("touchpoints")
    .select("id,notes")
    .eq("org_id", orgId)
    .in("notes", markers);
  if (existingError) throw existingError;

  const existingMarkers = new Set((existing ?? []).map((row) => row.notes));
  const typeCycle = ["call", "email", "text", "site_visit", "door_knock"] as const;

  const missing = markers
    .map((marker, i) => {
      const idx = i + 1;
      if (existingMarkers.has(marker)) return null;

      const opportunity = opportunities[i % opportunities.length];
      const property = propertyById.get(opportunity.property_id) ?? properties[i % properties.length];
      const fallbackContactId = contactIds[i % contactIds.length] ?? null;
      const touchpointContactId = opportunity.primary_contact_id || property.primary_contact_id || fallbackContactId;
      const touchpointAccountId =
        (touchpointContactId ? contactById.get(touchpointContactId)?.account_id : null) ||
        opportunity.account_id ||
        property.primary_account_id ||
        null;
      const typeKey = typeCycle[i % typeCycle.length];

      const touchpointTypeId = touchpointTypeIds.get(typeKey);
      if (!touchpointTypeId) {
        throw new Error(`Missing touchpoint_type_id for key: ${typeKey}`);
      }

      let outcomeKey = "connected";
      if (typeKey === "call" && idx % 3 === 0) outcomeKey = "no_answer";
      if (typeKey === "email") outcomeKey = "follow_up_sent";
      if (typeKey === "site_visit") outcomeKey = "inspection_set";

      const outcomeId = touchpointOutcomeIds.get(outcomeKey) ?? null;
      const repUserId = idx % 2 === 0 ? rep1Id : rep2Id;

      const happenedAt = new Date();
      happenedAt.setUTCDate(happenedAt.getUTCDate() - (idx % 12));
      happenedAt.setUTCHours(8 + (idx % 8), 0, 0, 0);

      return {
        org_id: orgId,
        rep_user_id: repUserId,
        property_id: property.id,
        account_id: touchpointAccountId,
        contact_id: touchpointContactId,
        opportunity_id: opportunity.id,
        touchpoint_type_id: touchpointTypeId,
        outcome_id: outcomeId,
        happened_at: happenedAt.toISOString(),
        notes: marker,
        created_by: createdBy,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (missing.length > 0) {
    const { error: insertError } = await client.from("touchpoints").insert(missing);
    if (insertError) throw insertError;
  }

  const { data: rows, error: fetchError } = await client
    .from("touchpoints")
    .select("id,notes")
    .eq("org_id", orgId)
    .in("notes", markers);
  if (fetchError) throw fetchError;

  return (rows ?? []) as TouchpointRow[];
}

async function ensureNextActions(
  client: SupabaseClient,
  orgId: string,
  createdBy: string,
  opportunities: OpportunityRow[],
  properties: PropertyRow[],
  contacts: ContactRow[],
  touchpointTypeIds: Map<string, string>,
  rep1Id: string,
  rep2Id: string,
): Promise<void> {
  const propertyById = new Map(properties.map((p) => [p.id, p]));
  const contactsById = new Map(contacts.map((c) => [c.id, c]));
  const contactsByAccount = new Map<string, ContactRow[]>();
  for (const contact of contacts) {
    const list = contactsByAccount.get(contact.account_id) ?? [];
    list.push(contact);
    contactsByAccount.set(contact.account_id, list);
  }

  const resolveContactAndAccount = (opportunity: OpportunityRow, idx: number) => {
    const property = propertyById.get(opportunity.property_id);

    let contactId =
      opportunity.primary_contact_id ||
      property?.primary_contact_id ||
      null;

    if (!contactId && property?.primary_account_id) {
      const accountContacts = contactsByAccount.get(property.primary_account_id) ?? [];
      contactId = accountContacts[idx % accountContacts.length]?.id ?? null;
    }

    if (!contactId && contacts.length > 0) {
      contactId = contacts[idx % contacts.length]?.id ?? null;
    }

    if (!contactId) {
      throw new Error("Cannot seed next_actions: no contact available to attach.");
    }

    const contact = contactsById.get(contactId);
    const accountId =
      contact?.account_id ||
      opportunity.account_id ||
      property?.primary_account_id ||
      null;

    return { contactId, accountId };
  };

  const markers = Array.from({ length: 15 }, (_, i) => noteFor("seed-next-action", i + 1));

  const { data: existing, error: existingError } = await client
    .from("next_actions")
    .select("id,notes")
    .eq("org_id", orgId)
    .in("notes", markers);
  if (existingError) throw existingError;

  const existingMarkers = new Set((existing ?? []).map((row) => row.notes));
  const recommendedTypeId = touchpointTypeIds.get("call") ?? null;

  const missing = markers
    .map((marker, i) => {
      if (existingMarkers.has(marker)) return null;

      const opportunity = opportunities[i % opportunities.length];
      const assignedUserId = i % 2 === 0 ? rep1Id : rep2Id;
      const resolved = resolveContactAndAccount(opportunity, i);

      const dueAt = new Date();
      dueAt.setUTCDate(dueAt.getUTCDate() + (i % 7));
      dueAt.setUTCHours(14, 0, 0, 0);

      return {
        org_id: orgId,
        property_id: opportunity.property_id,
        contact_id: resolved.contactId,
        account_id: resolved.accountId,
        opportunity_id: opportunity.id,
        assigned_user_id: assignedUserId,
        recommended_touchpoint_type_id: recommendedTypeId,
        due_at: dueAt.toISOString(),
        status: "open",
        notes: marker,
        created_by: createdBy,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (missing.length > 0) {
    const { error: insertError } = await client.from("next_actions").insert(missing);
    if (insertError) throw insertError;
  }

  const { data: seededRows, error: seededRowsError } = await client
    .from("next_actions")
    .select("id,notes,contact_id,account_id")
    .eq("org_id", orgId)
    .in("notes", markers);
  if (seededRowsError) throw seededRowsError;

  const seededByNote = new Map(
    (seededRows ?? [])
      .filter((row) => row.notes)
      .map((row) => [String(row.notes), row]),
  );

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    const row = seededByNote.get(marker);
    if (!row) continue;

    const opportunity = opportunities[i % opportunities.length];
    const resolved = resolveContactAndAccount(opportunity, i);
    const patch: Record<string, unknown> = {};
    if (!row.contact_id) {
      patch.contact_id = resolved.contactId;
    }

    const rowContactId = (row.contact_id as string | null) ?? null;
    const rowContact = rowContactId ? contactsById.get(rowContactId) : null;
    const derivedRowAccountId = rowContact?.account_id ?? resolved.accountId;
    if (!row.account_id && derivedRowAccountId) {
      patch.account_id = derivedRowAccountId;
    } else if (row.account_id && derivedRowAccountId && row.account_id !== derivedRowAccountId) {
      patch.account_id = derivedRowAccountId;
    }

    if (Object.keys(patch).length === 0) continue;

    const { error: updateError } = await client
      .from("next_actions")
      .update(patch)
      .eq("id", row.id)
      .eq("org_id", orgId);
    if (updateError) throw updateError;
  }
}

async function ensureScoreRules(
  client: SupabaseClient,
  orgId: string,
  createdBy: string,
  touchpointTypeIds: Map<string, string>,
  touchpointOutcomeIds: Map<string, string>,
): Promise<void> {
  const combos = [
    { type: "call", outcome: "connected", points: 5 },
    { type: "call", outcome: "no_answer", points: 1 },
    { type: "email", outcome: "follow_up_sent", points: 3 },
    { type: "site_visit", outcome: "inspection_set", points: 8 },
  ];

  for (const combo of combos) {
    const typeId = touchpointTypeIds.get(combo.type);
    const outcomeId = touchpointOutcomeIds.get(combo.outcome);
    if (!typeId || !outcomeId) continue;

    const { data: existing, error: existingError } = await client
      .from("score_rules")
      .select("id")
      .eq("org_id", orgId)
      .eq("touchpoint_type_id", typeId)
      .eq("outcome_id", outcomeId)
      .limit(1);

    if (existingError) throw existingError;
    if (existing && existing.length > 0) continue;

    const { error: insertError } = await client.from("score_rules").insert({
      org_id: orgId,
      touchpoint_type_id: typeId,
      outcome_id: outcomeId,
      points: combo.points,
      is_bonus: false,
      created_by: createdBy,
    });
    if (insertError) throw insertError;
  }
}

async function ensureScoreEvents(
  client: SupabaseClient,
  orgId: string,
  createdBy: string,
  touchpoints: TouchpointRow[],
  rep1Id: string,
  rep2Id: string,
): Promise<void> {
  const selected = touchpoints.slice(0, 12);

  for (let i = 0; i < selected.length; i++) {
    const tp = selected[i];
    const reason = `seed-touchpoint-award-${String(i + 1).padStart(2, "0")}`;
    const userId = i % 2 === 0 ? rep1Id : rep2Id;
    const points = i % 4 === 0 ? 8 : 3;

    const { data: existing, error: existingError } = await client
      .from("score_events")
      .select("id")
      .eq("org_id", orgId)
      .eq("touchpoint_id", tp.id)
      .eq("reason", reason)
      .limit(1);

    if (existingError) throw existingError;
    if (existing && existing.length > 0) continue;

    const { error: insertError } = await client.from("score_events").insert({
      org_id: orgId,
      user_id: userId,
      touchpoint_id: tp.id,
      points,
      reason,
      created_by: createdBy,
    });
    if (insertError) throw insertError;
  }
}

async function countByOrg(
  client: SupabaseClient,
  table: string,
  orgId: string,
): Promise<number> {
  const { count, error } = await client
    .from(table)
    .select("*", { head: true, count: "exact" })
    .eq("org_id", orgId);
  if (error) throw error;
  return count ?? 0;
}

async function main() {
  console.log("Seeding dev data...");
  let stage = "init";
  try {
    const usersByEmail = await listUsersByEmail(
      supabase,
      DEV_USERS.map((u) => u.email),
    );

    for (const user of DEV_USERS) {
      if (!usersByEmail.has(user.email.toLowerCase())) {
        throw new Error(
          `Missing required auth user ${user.email}. Run "npm run seed:dev" from a clean reset.`,
        );
      }
    }

    const adminId = usersByEmail.get("admin@dilly.dev")?.id;
    const rep1Id = usersByEmail.get("rep1@dilly.dev")?.id;
    const rep2Id = usersByEmail.get("rep2@dilly.dev")?.id;

    if (!adminId || !rep1Id || !rep2Id) {
      throw new Error("Missing required admin/rep ids after user lookup");
    }

    stage = "ensure org + memberships";
    console.log("Ensuring org + memberships...");
    const orgId = await ensureDevOrg(supabase, adminId);
    await ensureOrgUsers(supabase, orgId, usersByEmail);

    stage = "seed type tables";
    console.log("Seeding type tables...");
    const types = await ensureTypeTables(supabase, orgId, adminId);
    stage = "seed accounts/contacts/properties";
    console.log("Seeding accounts/contacts/properties...");
    const accounts = await ensureAccounts(supabase, orgId, adminId);
    const contacts = await ensureContacts(supabase, orgId, adminId, accounts);
    const properties = await ensureProperties(supabase, orgId, adminId, accounts, contacts);

    stage = "seed assignments/opportunities";
    console.log("Seeding assignments/opportunities...");
    await ensurePropertyLinks(supabase, orgId, adminId, properties);
    await ensurePropertyAssignments(supabase, orgId, adminId, properties, rep1Id, rep2Id);

    const opportunities = await ensureOpportunities(
      supabase,
      orgId,
      adminId,
      properties,
      types.scopeTypes,
      types.stages,
    );

    await ensureOpportunityAssignments(
      supabase,
      orgId,
      adminId,
      opportunities,
      rep1Id,
      rep2Id,
    );

    stage = "seed touchpoints/next actions/scoring";
    console.log("Seeding touchpoints/next actions/scoring...");
    const touchpoints = await ensureTouchpoints(
      supabase,
      orgId,
      adminId,
      properties,
      contacts,
      opportunities,
      types.touchpointTypes,
      types.touchpointOutcomes,
      rep1Id,
      rep2Id,
    );

    stage = "seed next actions";
    await ensureNextActions(
      supabase,
      orgId,
      adminId,
      opportunities,
      properties,
      contacts,
      types.touchpointTypes,
      rep1Id,
      rep2Id,
    );

    stage = "seed score rules";
    await ensureScoreRules(
      supabase,
      orgId,
      adminId,
      types.touchpointTypes,
      types.touchpointOutcomes,
    );

    stage = "seed score events";
    await ensureScoreEvents(supabase, orgId, adminId, touchpoints, rep1Id, rep2Id);

    stage = "summary counts";
    const summary = {
      org_users: await countByOrg(supabase, "org_users", orgId),
      accounts: await countByOrg(supabase, "accounts", orgId),
      contacts: await countByOrg(supabase, "contacts", orgId),
      properties: await countByOrg(supabase, "properties", orgId),
      property_assignments: await countByOrg(supabase, "property_assignments", orgId),
      opportunities: await countByOrg(supabase, "opportunities", orgId),
      opportunity_assignments: await countByOrg(supabase, "opportunity_assignments", orgId),
      touchpoints: await countByOrg(supabase, "touchpoints", orgId),
      next_actions: await countByOrg(supabase, "next_actions", orgId),
      score_rules: await countByOrg(supabase, "score_rules", orgId),
      score_events: await countByOrg(supabase, "score_events", orgId),
    };

    stage = "rep1 next actions count";
    const { count: rep1OpenNextActions, error: rep1OpenError } = await supabase
      .from("next_actions")
      .select("id", { head: true, count: "exact" })
      .eq("org_id", orgId)
      .eq("assigned_user_id", rep1Id)
      .eq("status", "open");
    if (rep1OpenError) throw rep1OpenError;

    console.log(`Seeded org: ${orgId} (${DEV_ORG_NAME})`);
    console.log("Summary counts:");
    for (const [key, value] of Object.entries(summary)) {
      console.log(`  ${key}: ${value}`);
    }
    console.log(`  rep1_open_next_actions: ${rep1OpenNextActions ?? 0}`);
  } catch (error: unknown) {
    throw new Error(`seed-dev-data failed at stage "${stage}": ${errorMessage(error)}`);
  }
}

main().catch((error: unknown) => {
  const msg = errorMessage(error);
  console.error(msg);
  process.exit(1);
});
