// LOCAL TESTING ONLY
// Hardcoded to local Supabase keys + rep1 credentials. Never run against production.
// Run: node scripts/focus-debug-convert.mjs
//
// Isolate the rpc_convert_prospect failure (kept for future regression checks).

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

async function rest(path, { token, body, method = "GET" } = {}) {
  const r = await fetch(`${URL}${path}`, {
    method,
    headers: { apikey: token === SECRET ? SECRET : ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, data: text ? JSON.parse(text) : null, raw: text };
}

const tokenRes = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "rep1@dilly.dev", password: "devpassword123!" }),
});
const auth = await tokenRes.json();
const token = auth.access_token;
console.log("rep1 actual user id (from JWT):", auth.user.id);

// Confirm rep1's org_users row
const me = await rest(`/rest/v1/org_users?select=user_id,org_id,role&user_id=eq.${auth.user.id}`, { token: SECRET });
console.log("rep1 org_users row:", me.data);

// Find a fresh prospect+suggestion for rep1 with status='new' (the previous run may have processed them already)
const sug = await rest(`/rest/v1/suggested_outreach?select=id,prospect_id,status,user_id,prospects(id,company_name,contact_first_name,contact_last_name,contact_title,email,phone,account_type)&user_id=eq.${auth.user.id}&status=eq.new`, { token: SECRET });
console.log("\nrep1's new suggestions:", JSON.stringify(sug.data, null, 2));

// Look up call type + outcome
const ttRes = await rest(`/rest/v1/touchpoint_types?select=id,key,org_id&key=eq.call`, { token });
const callType = (ttRes.data ?? []).find(t => t.org_id !== null) ?? (ttRes.data ?? []).find(t => t.org_id === null);
const outRes = await rest(`/rest/v1/touchpoint_outcomes?select=id,key,org_id&key=eq.connected_conversation`, { token });
const outcome = (outRes.data ?? []).find(o => o.org_id === null);

// Re-seed a fresh prospect + suggestion for the REAL rep1 user_id
const newProspect = await rest(`/rest/v1/prospects`, {
  token: SECRET, method: "POST",
  body: {
    org_id: me.data[0].org_id,
    company_name: "Smoke Test Roofing II",
    account_type: "owner",
    contact_first_name: "Real", contact_last_name: "Rep1Test", contact_title: "PM",
    email: "real@example.com", phone: "555-9999",
    source: "manual", status: "unworked",
  },
});
console.log("\nseed prospect status:", newProspect.status, "id:", newProspect.data?.[0]?.id?.slice(0,8));
const seededProspectId = newProspect.data[0].id;

const newSug = await rest(`/rest/v1/suggested_outreach`, {
  token: SECRET, method: "POST",
  body: {
    org_id: me.data[0].org_id,
    user_id: auth.user.id,
    prospect_id: seededProspectId,
    rank_score: 80,
    reason_codes: ["test"],
    status: "new",
  },
});
console.log("seed suggestion status:", newSug.status, "id:", newSug.data?.[0]?.id?.slice(0,8));

// Now re-fetch
const sug2 = await rest(`/rest/v1/suggested_outreach?select=id,prospect_id,prospects(id,company_name,contact_first_name,contact_last_name,contact_title,email,phone,account_type)&user_id=eq.${auth.user.id}&status=eq.new`, { token: SECRET });
console.log("\nsuggestions for real rep1:", JSON.stringify(sug2.data, null, 2));

// Test 1: p_log_touchpoint=false (skip the inner RPC call)
console.log("\n=== Test 1: convert with p_log_touchpoint=FALSE ===");
{
  const item = sug2.data[0];
  const p = item.prospects;
  const r = await rest(`/rest/v1/rpc/rpc_convert_prospect`, {
    token, method: "POST",
    body: {
      p_prospect_id: item.prospect_id,
      p_account_name: p.company_name,
      p_account_type: p.account_type, p_account_website: null, p_account_phone: p.phone, p_account_notes: null,
      p_create_contact: true,
      p_contact_full_name: null, p_contact_first_name: p.contact_first_name, p_contact_last_name: p.contact_last_name,
      p_contact_title: p.contact_title, p_contact_email: p.email, p_contact_phone: p.phone,
      p_create_property: false,
      p_property_address: null, p_property_city: null, p_property_state: null, p_property_postal_code: null,
      p_log_touchpoint: false,
      p_touchpoint_type_id: null, p_touchpoint_outcome_id: null, p_touchpoint_notes: null,
    },
  });
  console.log("status:", r.status, "body:", r.raw);
}

// Re-seed for test 2
const p2 = await rest(`/rest/v1/prospects`, {
  token: SECRET, method: "POST",
  body: { org_id: me.data[0].org_id, company_name: "Smoke Test III", account_type: "owner",
    contact_first_name: "Three", contact_last_name: "Test", source: "manual", status: "unworked" },
});
const sug3 = await rest(`/rest/v1/suggested_outreach`, {
  token: SECRET, method: "POST",
  body: { org_id: me.data[0].org_id, user_id: auth.user.id, prospect_id: p2.data[0].id, rank_score: 70, reason_codes: ["test2"], status: "new" },
});
console.log("\n=== Test 2: convert with p_log_touchpoint=TRUE ===");
{
  const r = await rest(`/rest/v1/rpc/rpc_convert_prospect`, {
    token, method: "POST",
    body: {
      p_prospect_id: p2.data[0].id,
      p_account_name: "Smoke Test III",
      p_account_type: "owner", p_account_website: null, p_account_phone: null, p_account_notes: null,
      p_create_contact: true,
      p_contact_full_name: null, p_contact_first_name: "Three", p_contact_last_name: "Test",
      p_contact_title: null, p_contact_email: null, p_contact_phone: null,
      p_create_property: false,
      p_property_address: null, p_property_city: null, p_property_state: null, p_property_postal_code: null,
      p_log_touchpoint: true,
      p_touchpoint_type_id: callType.id,
      p_touchpoint_outcome_id: outcome.id,
      p_touchpoint_notes: "smoke convert test 2",
    },
  });
  console.log("status:", r.status, "body:", r.raw);
}

if (false && sug.data?.[0]) {
  const item = sug.data[0];
  const p = item.prospects;
  console.log("\nAttempting convert with full params...");
  const r = await rest(`/rest/v1/rpc/rpc_convert_prospect`, {
    token, method: "POST",
    body: {
      p_prospect_id: item.prospect_id,
      p_account_name: p.company_name,
      p_account_type: p.account_type ?? null,
      p_account_website: null,
      p_account_phone: p.phone ?? null,
      p_account_notes: null,
      p_create_contact: true,
      p_contact_full_name: null,
      p_contact_first_name: p.contact_first_name,
      p_contact_last_name: p.contact_last_name,
      p_contact_title: p.contact_title,
      p_contact_email: p.email,
      p_contact_phone: p.phone,
      p_create_property: false,
      p_property_address: null, p_property_city: null, p_property_state: null, p_property_postal_code: null,
      p_log_touchpoint: true,
      p_touchpoint_type_id: callType.id,
      p_touchpoint_outcome_id: outcome.id,
      p_touchpoint_notes: "smoke test convert",
    },
  });
  console.log("status:", r.status);
  console.log("body:", r.raw);
}
