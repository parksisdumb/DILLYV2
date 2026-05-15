// LOCAL TESTING ONLY
// Hardcoded to local Supabase keys + rep1 credentials. Never run against production.
// Run: node scripts/focus-seed-and-test.mjs
//
// Seed minimal Focus Mode test data for rep1, then re-run the smoke test.

import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf8");
const getEnv = (k) => env.split("\n").find((l) => l.startsWith(k + "="))?.split("=").slice(1).join("=").replace(/[\r"']/g, "").trim();
const URL = getEnv("NEXT_PUBLIC_SUPABASE_URL") ?? "http://127.0.0.1:54321";
const ANON = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SECRET = getEnv("SUPABASE_SERVICE_ROLE_KEY");
if (!URL.includes("127.0.0.1") && !URL.includes("localhost")) {
  console.error("Refusing to run against non-local Supabase URL:", URL);
  process.exit(1);
}
if (!ANON || !SECRET) { console.error("Missing keys in .env.local"); process.exit(1); }

async function rest(path, { token, body, method = "GET", headers = {} } = {}) {
  const r = await fetch(`${URL}${path}`, {
    method,
    headers: {
      apikey: token === SECRET ? SECRET : ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { ok: r.ok, status: r.status, data: json, raw: text };
}

async function login(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Login failed: " + JSON.stringify(j));
  return j.access_token;
}

console.log("\n═══ State check ═══");
const token = await login("rep1@dilly.dev", "devpassword123!");
const me = await rest("/rest/v1/org_users?select=user_id,org_id&limit=1", { token });
const { user_id: userId, org_id: orgId } = me.data[0];
console.log(`  rep1 userId=${userId.slice(0,8)} orgId=${orgId.slice(0,8)}`);

// Counts of relevant tables
for (const t of ["next_actions","suggested_outreach","prospects","contacts","accounts","properties"]) {
  const r = await rest(`/rest/v1/${t}?select=id`, { token: SECRET, headers: { Prefer: "count=exact", Range: "0-0" } });
  console.log(`  ${t}: ${r.data?.length ?? 0} sample rows fetched (status ${r.status})`);
}

// What we need: at least one open next_action for rep1, and one suggested_outreach
// row for rep1 with status='new'. Use existing contacts/accounts/prospects.

console.log("\n═══ Seed: open next_action for rep1 ═══");
// Pick any existing contact + account + property
const ctc = await rest(`/rest/v1/contacts?select=id,account_id&account_id=not.is.null&limit=1`, { token: SECRET });
const c = ctc.data?.[0];
if (!c) { console.log("  ✗ no contacts available — can't seed"); process.exit(1); }
const propLookup = await rest(`/rest/v1/properties?select=id&primary_account_id=eq.${c.account_id}&limit=1`, { token: SECRET });
const propId = propLookup.data?.[0]?.id ?? null;
if (!propId) {
  // next_actions.property_id is NOT NULL — pick any property in this org
  const anyProp = await rest(`/rest/v1/properties?select=id&limit=1`, { token: SECRET });
  if (!anyProp.data?.[0]) { console.log("  ✗ no properties at all"); process.exit(1); }
  console.log(`  using fallback property ${anyProp.data[0].id.slice(0,8)} (no property linked to chosen account)`);
}
const finalPropId = propId ?? (await rest(`/rest/v1/properties?select=id&limit=1`, { token: SECRET })).data[0].id;

const dueAt = new Date(Date.now() - 60_000).toISOString(); // 1 min ago = overdue
const naIns = await rest(`/rest/v1/next_actions`, {
  token: SECRET,
  method: "POST",
  body: {
    org_id: orgId,
    property_id: finalPropId,
    contact_id: c.id,
    account_id: c.account_id,
    assigned_user_id: userId,
    due_at: dueAt,
    status: "open",
    notes: "Smoke test follow-up",
  },
});
if (!naIns.ok) { console.log("  ✗ next_actions insert failed:", naIns.raw); process.exit(1); }
const newNa = Array.isArray(naIns.data) ? naIns.data[0] : naIns.data;
console.log(`  ✓ inserted next_action ${newNa.id.slice(0,8)} (overdue, contact=${c.id.slice(0,8)})`);

console.log("\n═══ Seed: suggested_outreach + prospect for rep1 ═══");
// Try to find an existing un-converted prospect; if none, insert one.
let prospect = null;
const existingProspect = await rest(`/rest/v1/prospects?select=id,company_name&status=neq.converted&limit=1`, { token: SECRET });
if (existingProspect.data?.[0]) {
  prospect = existingProspect.data[0];
  console.log(`  using existing prospect ${prospect.id.slice(0,8)} "${prospect.company_name}"`);
} else {
  const newProspect = await rest(`/rest/v1/prospects`, {
    token: SECRET,
    method: "POST",
    body: {
      org_id: orgId,
      company_name: "Smoke Test Roofing Co",
      account_type: "owner",
      city: "Memphis", state: "TN",
      contact_first_name: "Test", contact_last_name: "Contact", contact_title: "Property Manager",
      email: "smoke@example.com",
      phone: "555-0100",
      source: "manual",
      status: "unworked",
    },
  });
  if (!newProspect.ok) { console.log("  ✗ prospects insert failed:", newProspect.raw); process.exit(1); }
  prospect = Array.isArray(newProspect.data) ? newProspect.data[0] : newProspect.data;
  console.log(`  ✓ inserted prospect ${prospect.id.slice(0,8)} "${prospect.company_name}"`);
}

// Insert suggested_outreach for rep1, status='new'
const sugIns = await rest(`/rest/v1/suggested_outreach`, {
  token: SECRET,
  method: "POST",
  body: {
    org_id: orgId,
    user_id: userId,
    prospect_id: prospect.id,
    rank_score: 75,
    reason_codes: ["high_priority"],
    status: "new",
  },
});
if (!sugIns.ok) { console.log("  ✗ suggested_outreach insert failed:", sugIns.raw); process.exit(1); }
const newSug = Array.isArray(sugIns.data) ? sugIns.data[0] : sugIns.data;
console.log(`  ✓ inserted suggested_outreach ${newSug.id.slice(0,8)} for rep1 (rank=75)`);

console.log("\n═══ Done seeding. Re-run scripts/focus-smoke-test.mjs ═══");
