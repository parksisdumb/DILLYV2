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

// ── Realistic commercial roofing seed data ─────────────────────────────

const ACCOUNT_SPECS = [
  { name: "Lone Star Property Group", type: "owner", website: "https://lonestarpg.com", phone: "214-555-0100" },
  { name: "Texas Commercial Realty", type: "commercial_property_management", website: "https://texascommercialrealty.com", phone: "972-555-0201" },
  { name: "DFW Facilities Management", type: "facilities_management", website: "https://dfwfm.com", phone: "469-555-0302" },
  { name: "Meridian Asset Partners", type: "asset_management", website: "https://meridianasset.com", phone: "214-555-0403" },
  { name: "Summit General Contractors", type: "general_contractor", website: "https://summitgc.com", phone: "817-555-0504" },
  { name: "Brazos Development Corp", type: "developer", website: "https://brazosdevelopment.com", phone: "254-555-0605" },
  { name: "Capital Commercial Advisors", type: "broker", website: "https://capitalcommercial.com", phone: "512-555-0706" },
  { name: "Pecan Park Office Partners", type: "owner", website: "https://pecanparkoffice.com", phone: "214-555-0807" },
  { name: "Trinity Industrial Holdings", type: "owner", website: "https://trinityindustrial.com", phone: "817-555-0908" },
  { name: "Crossroads Retail Group", type: "owner", website: "https://crossroadsretail.com", phone: "972-555-1009" },
];

const CONTACT_SPECS: { firstName: string; lastName: string; title: string; phone: string; accountIdx: number }[] = [
  // Lone Star Property Group (0)
  { firstName: "Mike", lastName: "Hargrove", title: "Director of Facilities", phone: "214-555-1101", accountIdx: 0 },
  { firstName: "Sarah", lastName: "Chen", title: "Property Manager", phone: "214-555-1102", accountIdx: 0 },
  // Texas Commercial Realty (1)
  { firstName: "James", lastName: "Whitfield", title: "VP of Operations", phone: "972-555-1201", accountIdx: 1 },
  { firstName: "Rachel", lastName: "Dominguez", title: "Asset Manager", phone: "972-555-1202", accountIdx: 1 },
  // DFW Facilities Management (2)
  { firstName: "Tom", lastName: "Bradley", title: "Facilities Director", phone: "469-555-1301", accountIdx: 2 },
  { firstName: "Anita", lastName: "Patel", title: "Maintenance Coordinator", phone: "469-555-1302", accountIdx: 2 },
  { firstName: "Derek", lastName: "Simmons", title: "Regional Manager", phone: "469-555-1303", accountIdx: 2 },
  // Meridian Asset Partners (3)
  { firstName: "Karen", lastName: "Holloway", title: "Portfolio Manager", phone: "214-555-1401", accountIdx: 3 },
  { firstName: "Luis", lastName: "Garza", title: "Asset Analyst", phone: "214-555-1402", accountIdx: 3 },
  // Summit General Contractors (4)
  { firstName: "Brian", lastName: "Kowalski", title: "Project Manager", phone: "817-555-1501", accountIdx: 4 },
  { firstName: "Jen", lastName: "Thornton", title: "Estimator", phone: "817-555-1502", accountIdx: 4 },
  // Brazos Development Corp (5)
  { firstName: "Chris", lastName: "Nguyen", title: "Development Director", phone: "254-555-1601", accountIdx: 5 },
  { firstName: "Amanda", lastName: "Reeves", title: "Project Coordinator", phone: "254-555-1602", accountIdx: 5 },
  // Capital Commercial Advisors (6)
  { firstName: "David", lastName: "Burke", title: "Senior Broker", phone: "512-555-1701", accountIdx: 6 },
  { firstName: "Patricia", lastName: "Wells", title: "Associate Broker", phone: "512-555-1702", accountIdx: 6 },
  // Pecan Park Office Partners (7)
  { firstName: "Steve", lastName: "McAllister", title: "Managing Partner", phone: "214-555-1801", accountIdx: 7 },
  { firstName: "Diana", lastName: "Ortiz", title: "Facilities Manager", phone: "214-555-1802", accountIdx: 7 },
  // Trinity Industrial Holdings (8)
  { firstName: "Robert", lastName: "Hale", title: "VP of Real Estate", phone: "817-555-1901", accountIdx: 8 },
  { firstName: "Lisa", lastName: "Carpenter", title: "Property Coordinator", phone: "817-555-1902", accountIdx: 8 },
  // Crossroads Retail Group (9)
  { firstName: "Marcus", lastName: "Webb", title: "Director of Construction", phone: "972-555-2001", accountIdx: 9 },
  { firstName: "Heather", lastName: "Flynn", title: "Lease Administrator", phone: "972-555-2002", accountIdx: 9 },
  { firstName: "Tony", lastName: "Russo", title: "Maintenance Supervisor", phone: "972-555-2003", accountIdx: 9 },
];

const PROPERTY_SPECS: {
  address: string; city: string; state: string; zip: string;
  roofType: string; roofAge: number; sqFootage: number;
  accountIdx: number; contactIdx: number;
}[] = [
  // Lone Star (0) — 2 properties
  { address: "4200 Spring Valley Rd", city: "Dallas", state: "TX", zip: "75244", roofType: "TPO", roofAge: 8, sqFootage: 45000, accountIdx: 0, contactIdx: 0 },
  { address: "1800 N Central Expy", city: "Richardson", state: "TX", zip: "75080", roofType: "Modified Bitumen", roofAge: 15, sqFootage: 32000, accountIdx: 0, contactIdx: 1 },
  // Texas Commercial (1) — 2 properties
  { address: "6100 Greenville Ave", city: "Dallas", state: "TX", zip: "75206", roofType: "EPDM", roofAge: 12, sqFootage: 28000, accountIdx: 1, contactIdx: 2 },
  { address: "3400 W Plano Pkwy", city: "Plano", state: "TX", zip: "75075", roofType: "TPO", roofAge: 5, sqFootage: 55000, accountIdx: 1, contactIdx: 3 },
  // DFW Facilities (2) — 2 properties
  { address: "901 E Carpenter Fwy", city: "Irving", state: "TX", zip: "75062", roofType: "Built-Up (BUR)", roofAge: 20, sqFootage: 72000, accountIdx: 2, contactIdx: 4 },
  { address: "2500 Dallas Pkwy", city: "Frisco", state: "TX", zip: "75034", roofType: "PVC", roofAge: 3, sqFootage: 38000, accountIdx: 2, contactIdx: 5 },
  // Meridian (3) — 1 property
  { address: "5050 Quorum Dr", city: "Dallas", state: "TX", zip: "75254", roofType: "Modified Bitumen", roofAge: 18, sqFootage: 90000, accountIdx: 3, contactIdx: 7 },
  // Summit GC (4) — 1 property
  { address: "1200 E Copeland Rd", city: "Arlington", state: "TX", zip: "76011", roofType: "Standing Seam Metal", roofAge: 2, sqFootage: 120000, accountIdx: 4, contactIdx: 9 },
  // Brazos Dev (5) — 1 property
  { address: "600 Congress Ave", city: "Austin", state: "TX", zip: "78701", roofType: "TPO", roofAge: 1, sqFootage: 65000, accountIdx: 5, contactIdx: 11 },
  // Capital Commercial (6) — 1 property
  { address: "300 W 6th St", city: "Austin", state: "TX", zip: "78701", roofType: "EPDM", roofAge: 14, sqFootage: 42000, accountIdx: 6, contactIdx: 13 },
  // Pecan Park (7) — 2 properties
  { address: "8700 N Stemmons Fwy", city: "Dallas", state: "TX", zip: "75247", roofType: "TPO", roofAge: 6, sqFootage: 52000, accountIdx: 7, contactIdx: 15 },
  { address: "4000 McEwen Rd", city: "Farmers Branch", state: "TX", zip: "75234", roofType: "Built-Up (BUR)", roofAge: 22, sqFootage: 34000, accountIdx: 7, contactIdx: 16 },
  // Trinity Industrial (8) — 2 properties
  { address: "1500 Industrial Blvd", city: "Fort Worth", state: "TX", zip: "76104", roofType: "Standing Seam Metal", roofAge: 10, sqFootage: 150000, accountIdx: 8, contactIdx: 17 },
  { address: "2200 Meacham Blvd", city: "Fort Worth", state: "TX", zip: "76106", roofType: "Modified Bitumen", roofAge: 16, sqFootage: 85000, accountIdx: 8, contactIdx: 18 },
  // Crossroads Retail (9) — 2 properties
  { address: "3200 Belt Line Rd", city: "Carrollton", state: "TX", zip: "75006", roofType: "TPO", roofAge: 7, sqFootage: 48000, accountIdx: 9, contactIdx: 19 },
  { address: "5600 N Garland Ave", city: "Garland", state: "TX", zip: "75040", roofType: "EPDM", roofAge: 19, sqFootage: 36000, accountIdx: 9, contactIdx: 20 },
];

const OPPORTUNITY_SPECS: {
  title: string; propertyIdx: number; scopeKey: string; stageKey: string;
  estimatedValue: number;
}[] = [
  { title: "Spring Valley Roof Replacement", propertyIdx: 0, scopeKey: "replacement", stageKey: "proposal_sent", estimatedValue: 185000 },
  { title: "Central Expy Leak Repair", propertyIdx: 1, scopeKey: "repair", stageKey: "inspection_scheduled", estimatedValue: 12000 },
  { title: "Greenville Ave Annual Inspection", propertyIdx: 2, scopeKey: "inspection", stageKey: "open", estimatedValue: 3500 },
  { title: "Plano Office Park Maintenance", propertyIdx: 3, scopeKey: "maintenance", stageKey: "open", estimatedValue: 8500 },
  { title: "Carpenter Fwy Re-Roof", propertyIdx: 4, scopeKey: "replacement", stageKey: "proposal_sent", estimatedValue: 320000 },
  { title: "Quorum Dr Coating Project", propertyIdx: 6, scopeKey: "maintenance", stageKey: "inspection_scheduled", estimatedValue: 45000 },
  { title: "Arlington Warehouse Inspection", propertyIdx: 7, scopeKey: "inspection", stageKey: "open", estimatedValue: 5000 },
  { title: "Congress Ave New Roof Warranty", propertyIdx: 8, scopeKey: "maintenance", stageKey: "open", estimatedValue: 2500 },
  { title: "Stemmons Fwy TPO Overlay", propertyIdx: 10, scopeKey: "replacement", stageKey: "inspection_scheduled", estimatedValue: 210000 },
  { title: "Industrial Blvd Metal Roof Repair", propertyIdx: 12, scopeKey: "repair", stageKey: "proposal_sent", estimatedValue: 28000 },
];

const TOUCHPOINT_TEMPLATES: {
  typeKey: string; outcomeKey: string; phase: string; notes: string;
  contactIdx: number; propertyIdx: number | null; daysAgo: number;
}[] = [
  // First-touch outreach wave (30-60 days ago)
  { typeKey: "call", outcomeKey: "connected", phase: "first_touch", notes: "Intro call — discussed roof age, interested in inspection", contactIdx: 0, propertyIdx: 0, daysAgo: 55 },
  { typeKey: "email", outcomeKey: "follow_up_sent", phase: "first_touch", notes: "Sent company intro and case studies", contactIdx: 2, propertyIdx: 2, daysAgo: 52 },
  { typeKey: "door_knock", outcomeKey: "connected", phase: "first_touch", notes: "Stopped by office — spoke with facilities director about BUR roof", contactIdx: 4, propertyIdx: 4, daysAgo: 50 },
  { typeKey: "call", outcomeKey: "no_answer", phase: "first_touch", notes: "No answer — left voicemail about roof inspection program", contactIdx: 7, propertyIdx: 6, daysAgo: 48 },
  { typeKey: "call", outcomeKey: "connected", phase: "first_touch", notes: "Great conversation — she manages portfolio of 12 buildings", contactIdx: 7, propertyIdx: null, daysAgo: 45 },
  { typeKey: "email", outcomeKey: "follow_up_sent", phase: "first_touch", notes: "Sent TPO vs EPDM comparison doc", contactIdx: 9, propertyIdx: 7, daysAgo: 44 },
  { typeKey: "site_visit", outcomeKey: "inspection_set", phase: "first_touch", notes: "Walked roof with Mike — significant ponding water areas", contactIdx: 0, propertyIdx: 0, daysAgo: 42 },
  { typeKey: "call", outcomeKey: "connected", phase: "first_touch", notes: "Intro call — new construction project needs roof spec", contactIdx: 11, propertyIdx: 8, daysAgo: 40 },
  { typeKey: "door_knock", outcomeKey: "connected", phase: "first_touch", notes: "Met Steve at property — showed him hail damage on north section", contactIdx: 15, propertyIdx: 10, daysAgo: 38 },
  { typeKey: "call", outcomeKey: "no_answer", phase: "first_touch", notes: "No answer — will try again Thursday", contactIdx: 17, propertyIdx: 12, daysAgo: 36 },
  // Follow-up wave (15-35 days ago)
  { typeKey: "call", outcomeKey: "connected", phase: "follow_up", notes: "Follow-up on inspection — ready for proposal", contactIdx: 0, propertyIdx: 0, daysAgo: 30 },
  { typeKey: "email", outcomeKey: "follow_up_sent", phase: "follow_up", notes: "Sent proposal for Carpenter Fwy re-roof — $320k", contactIdx: 4, propertyIdx: 4, daysAgo: 28 },
  { typeKey: "call", outcomeKey: "connected", phase: "follow_up", notes: "Discussed proposal — wants to compare with one more bid", contactIdx: 4, propertyIdx: 4, daysAgo: 25 },
  { typeKey: "site_visit", outcomeKey: "inspection_set", phase: "follow_up", notes: "Roof inspection with Karen — measured 90k SF, noted seam failures", contactIdx: 7, propertyIdx: 6, daysAgo: 22 },
  { typeKey: "email", outcomeKey: "follow_up_sent", phase: "follow_up", notes: "Sent maintenance agreement template", contactIdx: 3, propertyIdx: 3, daysAgo: 20 },
  { typeKey: "call", outcomeKey: "connected", phase: "follow_up", notes: "Robert wants metal roof repair quote by Friday", contactIdx: 17, propertyIdx: 12, daysAgo: 18 },
  { typeKey: "email", outcomeKey: "follow_up_sent", phase: "follow_up", notes: "Sent repair estimate — $28k for flashing and panel replacement", contactIdx: 17, propertyIdx: 12, daysAgo: 15 },
  { typeKey: "call", outcomeKey: "connected", phase: "follow_up", notes: "Diana confirmed board approved TPO overlay project", contactIdx: 16, propertyIdx: 10, daysAgo: 12 },
  // Recent activity (0-10 days ago)
  { typeKey: "call", outcomeKey: "no_answer", phase: "follow_up", notes: "Checking on Greenville Ave inspection date", contactIdx: 2, propertyIdx: 2, daysAgo: 8 },
  { typeKey: "site_visit", outcomeKey: "connected", phase: "follow_up", notes: "Walked Stemmons Fwy roof — measured for TPO overlay spec", contactIdx: 15, propertyIdx: 10, daysAgo: 7 },
  { typeKey: "email", outcomeKey: "follow_up_sent", phase: "follow_up", notes: "Sent revised Spring Valley proposal with warranty options", contactIdx: 0, propertyIdx: 0, daysAgo: 5 },
  { typeKey: "call", outcomeKey: "connected", phase: "follow_up", notes: "Brian confirmed Summit will sub us for the Arlington roof", contactIdx: 9, propertyIdx: 7, daysAgo: 4 },
  { typeKey: "door_knock", outcomeKey: "connected", phase: "first_touch", notes: "Dropped by — introduced services to Marcus", contactIdx: 19, propertyIdx: 14, daysAgo: 3 },
  { typeKey: "call", outcomeKey: "connected", phase: "follow_up", notes: "Mike wants to sign Spring Valley replacement contract next week", contactIdx: 0, propertyIdx: 0, daysAgo: 2 },
  { typeKey: "email", outcomeKey: "follow_up_sent", phase: "first_touch", notes: "Sent intro packet to Belt Line property contacts", contactIdx: 19, propertyIdx: 14, daysAgo: 1 },
  { typeKey: "call", outcomeKey: "connected", phase: "follow_up", notes: "Confirmed Carpenter Fwy proposal is with their board", contactIdx: 4, propertyIdx: 4, daysAgo: 0 },
];

const NEXT_ACTION_SPECS: {
  contactIdx: number; propertyIdx: number | null; oppIdx: number | null;
  typeKey: string; notes: string; daysFromNow: number; status: string;
}[] = [
  // Overdue
  { contactIdx: 2, propertyIdx: 2, oppIdx: 2, typeKey: "call", notes: "Schedule Greenville Ave inspection date", daysFromNow: -3, status: "open" },
  { contactIdx: 7, propertyIdx: 6, oppIdx: 5, typeKey: "email", notes: "Send Quorum Dr coating proposal", daysFromNow: -1, status: "open" },
  // Today
  { contactIdx: 0, propertyIdx: 0, oppIdx: 0, typeKey: "call", notes: "Confirm Spring Valley contract signing", daysFromNow: 0, status: "open" },
  { contactIdx: 4, propertyIdx: 4, oppIdx: 4, typeKey: "call", notes: "Follow up on Carpenter Fwy board decision", daysFromNow: 0, status: "open" },
  // Upcoming
  { contactIdx: 17, propertyIdx: 12, oppIdx: 9, typeKey: "site_visit", notes: "Metal roof repair pre-work site visit", daysFromNow: 2, status: "open" },
  { contactIdx: 15, propertyIdx: 10, oppIdx: 8, typeKey: "email", notes: "Send Stemmons TPO overlay proposal", daysFromNow: 3, status: "open" },
  { contactIdx: 11, propertyIdx: 8, oppIdx: 7, typeKey: "call", notes: "Check on Congress Ave warranty paperwork", daysFromNow: 5, status: "open" },
  { contactIdx: 3, propertyIdx: 3, oppIdx: 3, typeKey: "call", notes: "Follow up on Plano maintenance agreement", daysFromNow: 7, status: "open" },
  { contactIdx: 19, propertyIdx: 14, oppIdx: null, typeKey: "door_knock", notes: "Second visit to Belt Line Rd property", daysFromNow: 4, status: "open" },
  // Completed
  { contactIdx: 0, propertyIdx: 0, oppIdx: 0, typeKey: "email", notes: "Send revised proposal with warranty options", daysFromNow: -5, status: "completed" },
  { contactIdx: 9, propertyIdx: 7, oppIdx: 6, typeKey: "call", notes: "Confirm Arlington subcontract details", daysFromNow: -4, status: "completed" },
];

// ── Types ──────────────────────────────────────────────────────────────────

type TypeKeyRow = { id: string; key: string };
type AccountRow = { id: string; name: string };
type ContactRow = { id: string; email: string | null; account_id: string; full_name: string | null };
type PropertyRow = { id: string; external_ref: string | null; primary_account_id: string | null; primary_contact_id: string | null };
type OpportunityRow = { id: string; title: string | null; property_id: string; account_id: string | null; primary_contact_id: string | null };
type TouchpointRow = { id: string; notes: string | null };
type UserByEmail = { id: string; email: string };

if (!SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY) in env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── Helpers ────────────────────────────────────────────────────────────────

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || String(error);
  if (typeof error === "object" && error !== null) {
    try { return JSON.stringify(error); } catch { return String(error); }
  }
  return String(error);
}

async function listUsersByEmail(
  client: SupabaseClient,
  emails: string[],
): Promise<Map<string, UserByEmail>> {
  const wanted = new Set(emails.map((e) => e.toLowerCase()));
  const out = new Map<string, UserByEmail>();
  let page = 1;
  while (true) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const user of data.users) {
      const email = (user.email || "").toLowerCase();
      if (wanted.has(email) && user.id) out.set(email, { id: user.id, email });
    }
    if (data.users.length < 200 || out.size === wanted.size) break;
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
    if (signInError) return null;

    const { data, error } = await sessionClient.rpc("rpc_bootstrap_org", { p_org_name: DEV_ORG_NAME });
    await sessionClient.auth.signOut();
    if (error) return null;
    if (typeof data === "string" && data) return data;
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === "string") return data[0];
    return null;
  } catch {
    return null;
  }
}

async function ensureDevOrg(client: SupabaseClient, adminUserId: string): Promise<string> {
  const { data: existing, error: existingError } = await client
    .from("orgs")
    .select("id, created_at")
    .eq("name", DEV_ORG_NAME)
    .order("created_at", { ascending: true });
  if (existingError) throw existingError;

  if (existing && existing.length > 0) return existing[0].id;

  const rpcOrgId = await tryBootstrapOrgViaRpc();
  if (rpcOrgId) return rpcOrgId;

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
    return { org_id: orgId, user_id: found.id, role: u.role };
  });
  const { error } = await client.from("org_users").upsert(rows, { onConflict: "user_id", ignoreDuplicates: false });
  if (error) throw error;
}

async function ensureProfiles(
  client: SupabaseClient,
  users: Map<string, UserByEmail>,
): Promise<void> {
  const profileSpecs = [
    { email: "admin@dilly.dev", fullName: "Jordan Mitchell" },
    { email: "manager@dilly.dev", fullName: "Casey Rivera" },
    { email: "rep1@dilly.dev", fullName: "Tyler Dawson" },
    { email: "rep2@dilly.dev", fullName: "Megan Foster" },
  ];
  for (const spec of profileSpecs) {
    const user = users.get(spec.email.toLowerCase());
    if (!user) continue;
    const { data: existing } = await client
      .from("profiles")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing) {
      await client.from("profiles").update({ full_name: spec.fullName }).eq("user_id", user.id);
    } else {
      await client.from("profiles").insert({ user_id: user.id, full_name: spec.fullName });
    }
  }
}

// ── Type tables (touchpoint_types, outcomes, scope_types, stages, etc.) ──

async function upsertKeyRows(
  client: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  const { error } = await client.from(table).upsert(rows, { onConflict: "org_id,key", ignoreDuplicates: false });
  if (error) throw error;
}

async function fetchKeyIdMap(
  client: SupabaseClient,
  table: string,
  orgId: string,
  keys: string[],
): Promise<Map<string, string>> {
  const { data, error } = await client.from(table).select("id,key").eq("org_id", orgId).in("key", keys);
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
  ];
  await upsertKeyRows(client, "touchpoint_types", touchpointTypeRows);

  const touchpointTypeMap = await fetchKeyIdMap(
    client, "touchpoint_types", orgId,
    touchpointTypeRows.map((r) => r.key),
  );

  const outcomeRows = [
    { org_id: orgId, key: "connected", name: "Connected", category: "engagement", sort_order: 10, touchpoint_type_id: touchpointTypeMap.get("call") ?? null, created_by: createdBy },
    { org_id: orgId, key: "no_answer", name: "No Answer", category: "engagement", sort_order: 20, touchpoint_type_id: touchpointTypeMap.get("call") ?? null, created_by: createdBy },
    { org_id: orgId, key: "follow_up_sent", name: "Follow Up Sent", category: "engagement", sort_order: 30, touchpoint_type_id: touchpointTypeMap.get("email") ?? null, created_by: createdBy },
    { org_id: orgId, key: "inspection_set", name: "Inspection Set", category: "inspection", sort_order: 40, touchpoint_type_id: touchpointTypeMap.get("site_visit") ?? null, created_by: createdBy },
  ];
  await upsertKeyRows(client, "touchpoint_outcomes", outcomeRows);

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

  return {
    scopeTypes: await fetchKeyIdMap(client, "scope_types", orgId, scopeRows.map((r) => r.key)),
    stages: await fetchKeyIdMap(client, "opportunity_stages", orgId, stageRows.map((r) => r.key)),
    touchpointTypes: touchpointTypeMap,
    touchpointOutcomes: await fetchKeyIdMap(client, "touchpoint_outcomes", orgId, outcomeRows.map((r) => r.key)),
  };
}

// ── Accounts ───────────────────────────────────────────────────────────────

async function ensureAccounts(
  client: SupabaseClient,
  orgId: string,
  createdBy: string,
): Promise<AccountRow[]> {
  const names = ACCOUNT_SPECS.map((s) => s.name);
  const { data: existing, error: existingError } = await client
    .from("accounts").select("id,name").eq("org_id", orgId).in("name", names);
  if (existingError) throw existingError;

  const existingNames = new Set((existing ?? []).map((r) => r.name));
  const missing = ACCOUNT_SPECS
    .filter((s) => !existingNames.has(s.name))
    .map((s) => ({
      org_id: orgId,
      name: s.name,
      account_type: s.type,
      website: s.website,
      phone: s.phone,
      created_by: createdBy,
    }));

  if (missing.length > 0) {
    const { error } = await client.from("accounts").insert(missing);
    if (error) throw error;
  }

  const { data: rows, error: fetchError } = await client
    .from("accounts").select("id,name").eq("org_id", orgId).in("name", names);
  if (fetchError) throw fetchError;
  return (rows ?? []) as AccountRow[];
}

// ── Contacts ───────────────────────────────────────────────────────────────

async function ensureContacts(
  client: SupabaseClient,
  orgId: string,
  createdBy: string,
  accounts: AccountRow[],
): Promise<ContactRow[]> {
  const accountByIdx = new Map<number, string>();
  for (let i = 0; i < ACCOUNT_SPECS.length; i++) {
    const account = accounts.find((a) => a.name === ACCOUNT_SPECS[i].name);
    if (account) accountByIdx.set(i, account.id);
  }

  const specs = CONTACT_SPECS.map((c, i) => {
    const accountId = accountByIdx.get(c.accountIdx);
    if (!accountId) throw new Error(`Missing account for contact ${c.firstName} ${c.lastName}`);
    const email = `${c.firstName.toLowerCase()}.${c.lastName.toLowerCase()}@dilly.dev`;
    return {
      email,
      full_name: `${c.firstName} ${c.lastName}`,
      first_name: c.firstName,
      last_name: c.lastName,
      title: c.title,
      phone: c.phone,
      decision_role: i % 2 === 0 ? "decision_maker" : "influencer",
      priority_score: Math.min(7, Math.floor(i / 3) + 1),
      account_id: accountId,
    };
  });

  const emails = specs.map((s) => s.email);
  const { data: existing, error: existingError } = await client
    .from("contacts").select("id,email,account_id,full_name").eq("org_id", orgId).in("email", emails);
  if (existingError) throw existingError;

  const existingEmails = new Set((existing ?? []).map((r) => (r.email || "").toLowerCase()));
  const missing = specs
    .filter((s) => !existingEmails.has(s.email.toLowerCase()))
    .map((s) => ({ org_id: orgId, ...s, created_by: createdBy }));

  if (missing.length > 0) {
    const { error } = await client.from("contacts").insert(missing);
    if (error) throw error;
  }

  const { data: rows, error: fetchError } = await client
    .from("contacts").select("id,email,account_id,full_name").eq("org_id", orgId).in("email", emails);
  if (fetchError) throw fetchError;
  return (rows ?? []) as ContactRow[];
}

// ── Properties ─────────────────────────────────────────────────────────────

async function ensureProperties(
  client: SupabaseClient,
  orgId: string,
  createdBy: string,
  accounts: AccountRow[],
  contacts: ContactRow[],
): Promise<PropertyRow[]> {
  const accountByIdx = new Map<number, string>();
  for (let i = 0; i < ACCOUNT_SPECS.length; i++) {
    const account = accounts.find((a) => a.name === ACCOUNT_SPECS[i].name);
    if (account) accountByIdx.set(i, account.id);
  }
  const contactByIdx = new Map<number, string>();
  for (let i = 0; i < CONTACT_SPECS.length; i++) {
    const spec = CONTACT_SPECS[i];
    const contact = contacts.find((c) => c.full_name === `${spec.firstName} ${spec.lastName}`);
    if (contact) contactByIdx.set(i, contact.id);
  }

  const refs = PROPERTY_SPECS.map((_, i) => `seed-prop-${String(i + 1).padStart(2, "0")}`);
  const { data: existing, error: existingError } = await client
    .from("properties").select("id,external_ref,primary_account_id,primary_contact_id")
    .eq("org_id", orgId).in("external_ref", refs);
  if (existingError) throw existingError;

  const existingRefs = new Set((existing ?? []).map((r) => r.external_ref));
  const missing = PROPERTY_SPECS
    .map((p, i) => {
      const ref = refs[i];
      if (existingRefs.has(ref)) return null;
      return {
        org_id: orgId,
        external_ref: ref,
        address_line1: p.address,
        city: p.city,
        state: p.state,
        postal_code: p.zip,
        country: "US",
        roof_type: p.roofType,
        roof_age_years: p.roofAge,
        sq_footage: p.sqFootage,
        primary_account_id: accountByIdx.get(p.accountIdx) ?? null,
        primary_contact_id: contactByIdx.get(p.contactIdx) ?? null,
        created_by: createdBy,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (missing.length > 0) {
    const { error } = await client.from("properties").insert(missing);
    if (error) throw error;
  }

  const { data: rows, error: fetchError } = await client
    .from("properties").select("id,external_ref,primary_account_id,primary_contact_id")
    .eq("org_id", orgId).in("external_ref", refs);
  if (fetchError) throw fetchError;
  return (rows ?? []) as PropertyRow[];
}

// ── Property links & assignments ───────────────────────────────────────────

async function ensurePropertyAssignments(
  client: SupabaseClient,
  orgId: string,
  createdBy: string,
  properties: PropertyRow[],
  rep1Id: string,
  rep2Id: string,
): Promise<void> {
  const rows = properties.flatMap((p, i) => {
    const primary = i % 2 === 0 ? rep1Id : rep2Id;
    return [
      { org_id: orgId, property_id: p.id, user_id: primary, assignment_role: "assigned_rep", created_by: createdBy },
    ];
  });
  const { error } = await client.from("property_assignments").upsert(rows, { onConflict: "property_id,user_id", ignoreDuplicates: false });
  if (error) throw error;
}

async function ensurePropertyLinks(
  client: SupabaseClient,
  orgId: string,
  createdBy: string,
  properties: PropertyRow[],
): Promise<void> {
  for (const p of properties) {
    if (!p.primary_account_id) continue;
    const { data: exists } = await client
      .from("property_accounts").select("id")
      .eq("org_id", orgId).eq("property_id", p.id).eq("account_id", p.primary_account_id).limit(1);
    if (exists && exists.length > 0) continue;
    await client.from("property_accounts").insert({
      org_id: orgId, property_id: p.id, account_id: p.primary_account_id,
      relationship_type: "property_manager", is_primary: true, active: true, created_by: createdBy,
    });
  }

  for (const p of properties) {
    if (!p.primary_contact_id) continue;
    const { error } = await client.from("property_contacts").upsert({
      org_id: orgId, property_id: p.id, contact_id: p.primary_contact_id,
      role_category: "decision_maker", role_label: "Primary Contact", priority_rank: 1,
      is_primary: true, active: true, created_by: createdBy,
    }, { onConflict: "property_id,contact_id,role_category", ignoreDuplicates: false });
    if (error) throw error;
  }
}

// ── Opportunities ──────────────────────────────────────────────────────────

async function ensureOpportunities(
  client: SupabaseClient,
  orgId: string,
  createdBy: string,
  properties: PropertyRow[],
  scopeTypeIds: Map<string, string>,
  stageIds: Map<string, string>,
): Promise<OpportunityRow[]> {
  const propertyByRef = new Map(properties.filter((p) => p.external_ref).map((p) => [p.external_ref as string, p]));

  const specs = OPPORTUNITY_SPECS.map((o) => {
    const ref = `seed-prop-${String(o.propertyIdx + 1).padStart(2, "0")}`;
    const property = propertyByRef.get(ref);
    if (!property) throw new Error(`Missing property for opportunity: ${o.title} (ref=${ref})`);
    const scopeId = scopeTypeIds.get(o.scopeKey);
    const stageId = stageIds.get(o.stageKey);
    if (!scopeId || !stageId) throw new Error(`Missing scope/stage for ${o.title}`);
    return {
      title: o.title,
      property_id: property.id,
      scope_type_id: scopeId,
      stage_id: stageId,
      status: "open" as const,
      estimated_value: o.estimatedValue,
      created_reason: "manual_seed",
      account_id: property.primary_account_id,
      primary_contact_id: property.primary_contact_id,
    };
  });

  const titles = specs.map((s) => s.title);
  const { data: existing, error: existingError } = await client
    .from("opportunities").select("id,title").eq("org_id", orgId).in("title", titles);
  if (existingError) throw existingError;

  const existingTitles = new Set((existing ?? []).map((r) => r.title));
  const missing = specs
    .filter((s) => !existingTitles.has(s.title))
    .map((s) => ({ org_id: orgId, ...s, created_by: createdBy }));

  if (missing.length > 0) {
    const { error } = await client.from("opportunities").insert(missing);
    if (error) throw error;
  }

  const { data: rows, error: fetchError } = await client
    .from("opportunities").select("id,title,property_id,account_id,primary_contact_id")
    .eq("org_id", orgId).in("title", titles);
  if (fetchError) throw fetchError;
  return (rows ?? []) as OpportunityRow[];
}

async function ensureOpportunityAssignments(
  client: SupabaseClient,
  orgId: string,
  createdBy: string,
  opportunities: OpportunityRow[],
  rep1Id: string,
  rep2Id: string,
): Promise<void> {
  const rows = opportunities.map((opp, i) => ({
    org_id: orgId,
    opportunity_id: opp.id,
    user_id: i % 2 === 0 ? rep1Id : rep2Id,
    assignment_role: "primary_rep",
    is_primary: true,
    created_by: createdBy,
  }));
  const { error } = await client.from("opportunity_assignments").upsert(rows, { onConflict: "opportunity_id,user_id", ignoreDuplicates: false });
  if (error) throw error;
}

// ── Touchpoints ────────────────────────────────────────────────────────────

async function ensureTouchpoints(
  client: SupabaseClient,
  orgId: string,
  properties: PropertyRow[],
  contacts: ContactRow[],
  touchpointTypeIds: Map<string, string>,
  touchpointOutcomeIds: Map<string, string>,
  rep1Id: string,
  managerId: string,
): Promise<TouchpointRow[]> {
  const propertyByRef = new Map(properties.filter((p) => p.external_ref).map((p) => [p.external_ref as string, p]));
  const contactByIdx = new Map<number, ContactRow>();
  for (let i = 0; i < CONTACT_SPECS.length; i++) {
    const spec = CONTACT_SPECS[i];
    const contact = contacts.find((c) => c.full_name === `${spec.firstName} ${spec.lastName}`);
    if (contact) contactByIdx.set(i, contact);
  }

  const markers = TOUCHPOINT_TEMPLATES.map((_, i) => `seed-tp-${String(i + 1).padStart(2, "0")}`);
  const { data: existing, error: existingError } = await client
    .from("touchpoints").select("id,notes").eq("org_id", orgId).in("notes", markers);
  if (existingError) throw existingError;
  const existingMarkers = new Set((existing ?? []).map((r) => r.notes));

  const missing = TOUCHPOINT_TEMPLATES
    .map((t, i) => {
      const marker = markers[i];
      if (existingMarkers.has(marker)) return null;

      const typeId = touchpointTypeIds.get(t.typeKey);
      if (!typeId) throw new Error(`Missing touchpoint type: ${t.typeKey}`);
      const outcomeId = touchpointOutcomeIds.get(t.outcomeKey) ?? null;
      const contact = contactByIdx.get(t.contactIdx);
      if (!contact) throw new Error(`Missing contact at index ${t.contactIdx}`);

      let propertyId: string | null = null;
      if (t.propertyIdx !== null) {
        const ref = `seed-prop-${String(t.propertyIdx + 1).padStart(2, "0")}`;
        propertyId = propertyByRef.get(ref)?.id ?? null;
      }

      const happenedAt = new Date();
      happenedAt.setUTCDate(happenedAt.getUTCDate() - t.daysAgo);
      happenedAt.setUTCHours(8 + (i % 8), (i * 15) % 60, 0, 0);

      // Alternate between rep1 and manager for touchpoint ownership
      const repUserId = i % 3 === 0 ? managerId : rep1Id;

      return {
        org_id: orgId,
        rep_user_id: repUserId,
        property_id: propertyId,
        account_id: contact.account_id,
        contact_id: contact.id,
        touchpoint_type_id: typeId,
        outcome_id: outcomeId,
        engagement_phase: t.phase,
        happened_at: happenedAt.toISOString(),
        notes: marker,
        created_by: repUserId,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (missing.length > 0) {
    const { error } = await client.from("touchpoints").insert(missing);
    if (error) throw error;
  }

  const { data: rows, error: fetchError } = await client
    .from("touchpoints").select("id,notes").eq("org_id", orgId).in("notes", markers);
  if (fetchError) throw fetchError;
  return (rows ?? []) as TouchpointRow[];
}

// ── Next Actions ───────────────────────────────────────────────────────────

async function ensureNextActions(
  client: SupabaseClient,
  orgId: string,
  contacts: ContactRow[],
  properties: PropertyRow[],
  opportunities: OpportunityRow[],
  touchpointTypeIds: Map<string, string>,
  rep1Id: string,
): Promise<void> {
  const contactByIdx = new Map<number, ContactRow>();
  for (let i = 0; i < CONTACT_SPECS.length; i++) {
    const spec = CONTACT_SPECS[i];
    const contact = contacts.find((c) => c.full_name === `${spec.firstName} ${spec.lastName}`);
    if (contact) contactByIdx.set(i, contact);
  }

  const propertyByRef = new Map(properties.filter((p) => p.external_ref).map((p) => [p.external_ref as string, p]));
  const oppByTitle = new Map(opportunities.filter((o) => o.title).map((o) => [o.title as string, o]));

  const markers = NEXT_ACTION_SPECS.map((_, i) => `seed-na-${String(i + 1).padStart(2, "0")}`);
  const { data: existing, error: existingError } = await client
    .from("next_actions").select("id,notes").eq("org_id", orgId).in("notes", markers);
  if (existingError) throw existingError;
  const existingMarkers = new Set((existing ?? []).map((r) => r.notes));

  const missing = NEXT_ACTION_SPECS
    .map((na, i) => {
      const marker = markers[i];
      if (existingMarkers.has(marker)) return null;

      const contact = contactByIdx.get(na.contactIdx);
      if (!contact) return null;

      let propertyId: string | null = null;
      if (na.propertyIdx !== null) {
        const ref = `seed-prop-${String(na.propertyIdx + 1).padStart(2, "0")}`;
        propertyId = propertyByRef.get(ref)?.id ?? null;
      }

      let opportunityId: string | null = null;
      if (na.oppIdx !== null) {
        const opp = opportunities[na.oppIdx];
        if (opp) opportunityId = opp.id;
      }

      const typeId = touchpointTypeIds.get(na.typeKey) ?? null;

      const dueAt = new Date();
      dueAt.setUTCDate(dueAt.getUTCDate() + na.daysFromNow);
      dueAt.setUTCHours(14, 0, 0, 0);

      return {
        org_id: orgId,
        contact_id: contact.id,
        account_id: contact.account_id,
        property_id: propertyId,
        opportunity_id: opportunityId,
        assigned_user_id: rep1Id,
        recommended_touchpoint_type_id: typeId,
        due_at: dueAt.toISOString(),
        status: na.status,
        notes: marker,
        created_by: rep1Id,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (missing.length > 0) {
    const { error } = await client.from("next_actions").insert(missing);
    if (error) throw error;
  }
}

// ── Score rules & events ───────────────────────────────────────────────────

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

    const { data: exists } = await client
      .from("score_rules").select("id").eq("org_id", orgId)
      .eq("touchpoint_type_id", typeId).eq("outcome_id", outcomeId).limit(1);
    if (exists && exists.length > 0) continue;

    await client.from("score_rules").insert({
      org_id: orgId, touchpoint_type_id: typeId, outcome_id: outcomeId,
      points: combo.points, is_bonus: false, created_by: createdBy,
    });
  }
}

async function ensureScoreEvents(
  client: SupabaseClient,
  orgId: string,
  touchpoints: TouchpointRow[],
  rep1Id: string,
  managerId: string,
): Promise<void> {
  const selected = touchpoints.slice(0, 12);
  for (let i = 0; i < selected.length; i++) {
    const tp = selected[i];
    const reason = `seed-score-${String(i + 1).padStart(2, "0")}`;
    const userId = i % 3 === 0 ? managerId : rep1Id;
    const points = i % 4 === 0 ? 8 : i % 3 === 0 ? 5 : 3;

    const { data: exists } = await client
      .from("score_events").select("id").eq("org_id", orgId)
      .eq("touchpoint_id", tp.id).eq("reason", reason).limit(1);
    if (exists && exists.length > 0) continue;

    await client.from("score_events").insert({
      org_id: orgId, user_id: userId, touchpoint_id: tp.id,
      points, reason, created_by: userId,
    });
  }
}

// ── Count helper ───────────────────────────────────────────────────────────

async function countByOrg(client: SupabaseClient, table: string, orgId: string): Promise<number> {
  const { count, error } = await client
    .from(table).select("*", { head: true, count: "exact" }).eq("org_id", orgId);
  if (error) throw error;
  return count ?? 0;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("Seeding dev data (commercial roofing)...\n");
  let stage = "init";
  try {
    const usersByEmail = await listUsersByEmail(supabase, DEV_USERS.map((u) => u.email));
    for (const user of DEV_USERS) {
      if (!usersByEmail.has(user.email.toLowerCase())) {
        throw new Error(`Missing required auth user ${user.email}. Run seed-dev-users.ts first.`);
      }
    }

    const adminId = usersByEmail.get("admin@dilly.dev")!.id;
    const managerId = usersByEmail.get("manager@dilly.dev")!.id;
    const rep1Id = usersByEmail.get("rep1@dilly.dev")!.id;
    const rep2Id = usersByEmail.get("rep2@dilly.dev")!.id;

    stage = "org + memberships";
    console.log("  Org + memberships...");
    const orgId = await ensureDevOrg(supabase, adminId);
    await ensureOrgUsers(supabase, orgId, usersByEmail);
    await ensureProfiles(supabase, usersByEmail);

    stage = "type tables";
    console.log("  Type tables...");
    const types = await ensureTypeTables(supabase, orgId, adminId);

    stage = "accounts";
    console.log("  Accounts...");
    const accounts = await ensureAccounts(supabase, orgId, adminId);

    stage = "contacts";
    console.log("  Contacts...");
    const contacts = await ensureContacts(supabase, orgId, adminId, accounts);

    stage = "properties";
    console.log("  Properties...");
    const properties = await ensureProperties(supabase, orgId, adminId, accounts, contacts);

    stage = "property links + assignments";
    console.log("  Property links + assignments...");
    await ensurePropertyLinks(supabase, orgId, adminId, properties);
    await ensurePropertyAssignments(supabase, orgId, adminId, properties, rep1Id, rep2Id);

    stage = "opportunities";
    console.log("  Opportunities...");
    const opportunities = await ensureOpportunities(supabase, orgId, adminId, properties, types.scopeTypes, types.stages);
    await ensureOpportunityAssignments(supabase, orgId, adminId, opportunities, rep1Id, rep2Id);

    stage = "touchpoints";
    console.log("  Touchpoints...");
    const touchpoints = await ensureTouchpoints(
      supabase, orgId, properties, contacts,
      types.touchpointTypes, types.touchpointOutcomes,
      rep1Id, managerId,
    );

    stage = "next actions";
    console.log("  Next actions...");
    await ensureNextActions(supabase, orgId, contacts, properties, opportunities, types.touchpointTypes, rep1Id);

    stage = "scoring";
    console.log("  Score rules + events...");
    await ensureScoreRules(supabase, orgId, adminId, types.touchpointTypes, types.touchpointOutcomes);
    await ensureScoreEvents(supabase, orgId, touchpoints, rep1Id, managerId);

    // Summary
    const summary = {
      org_users: await countByOrg(supabase, "org_users", orgId),
      accounts: await countByOrg(supabase, "accounts", orgId),
      contacts: await countByOrg(supabase, "contacts", orgId),
      properties: await countByOrg(supabase, "properties", orgId),
      opportunities: await countByOrg(supabase, "opportunities", orgId),
      touchpoints: await countByOrg(supabase, "touchpoints", orgId),
      next_actions: await countByOrg(supabase, "next_actions", orgId),
      score_events: await countByOrg(supabase, "score_events", orgId),
    };

    console.log(`\nSeeded org: ${orgId} ("${DEV_ORG_NAME}")`);
    console.log("Counts:");
    for (const [key, value] of Object.entries(summary)) {
      console.log(`  ${key}: ${value}`);
    }
    console.log("\nDev users:");
    console.log("  admin@dilly.dev  (Jordan Mitchell, admin)");
    console.log("  manager@dilly.dev (Casey Rivera, manager)");
    console.log("  rep1@dilly.dev   (Tyler Dawson, rep)");
    console.log("  rep2@dilly.dev   (Megan Foster, rep)");
    console.log("  Password: devpassword123!");
    console.log("\nDone.");
  } catch (error: unknown) {
    throw new Error(`seed-dev-data failed at stage "${stage}": ${errorMessage(error)}`);
  }
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exit(1);
});
