// LOCAL TESTING ONLY
// Hardcoded to local Supabase keys + rep1 credentials. Never run against production.
// Run: node scripts/focus-smoke-test-v2.mjs
//
// Final smoke test — exercises the post-fix two-step convert flow end-to-end.

// All keys read from .env.local — never hardcoded.
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

async function login(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (await r.json()).access_token;
}

function header(label) { console.log("\n" + "═".repeat(70) + "\n  " + label + "\n" + "═".repeat(70)); }

const token = await login("rep1@dilly.dev", "devpassword123!");
const auth = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
const userId = auth.sub;
const me = await rest(`/rest/v1/org_users?select=org_id&user_id=eq.${userId}`, { token: SECRET });
const orgId = me.data[0].org_id;
console.log("rep1 user_id:", userId);

// Lookups
const ttRes = await rest(`/rest/v1/touchpoint_types?select=id,key,org_id&key=eq.call`, { token });
const callType = (ttRes.data ?? []).find(t => t.org_id !== null);
const outRes = await rest(`/rest/v1/touchpoint_outcomes?select=id,key,org_id&key=eq.connected_conversation`, { token });
const outcome = (outRes.data ?? []).find(o => o.org_id === null);

// Seed a fresh prospect for this run so we have something to convert
const ts = Date.now();
const newProspect = await rest(`/rest/v1/prospects`, {
  token: SECRET, method: "POST",
  body: { org_id: orgId, company_name: `Smoke Test ${ts}`, account_type: "owner",
    contact_first_name: "Final", contact_last_name: "Test", contact_title: "Property Manager",
    email: `final-${ts}@example.com`, phone: "555-7777", source: "manual", status: "unworked" },
});
const newSug = await rest(`/rest/v1/suggested_outreach`, {
  token: SECRET, method: "POST",
  body: { org_id: orgId, user_id: userId, prospect_id: newProspect.data[0].id, rank_score: 90, reason_codes: ["smoke"], status: "new" },
});
console.log("seeded prospect:", newProspect.data[0].id.slice(0,8), "+ suggestion:", newSug.data[0].id.slice(0,8));

header("Before snapshot");
const beforeAccountCount = (await rest(`/rest/v1/accounts?select=id`, { token: SECRET })).data?.length ?? 0;
const beforeTpCount = (await rest(`/rest/v1/touchpoints?select=id`, { token: SECRET })).data?.length ?? 0;
const beforeScoreToday = (await rest(`/rest/v1/score_events?select=points&user_id=eq.${userId}&created_at=gte.${encodeURIComponent(new Date(new Date().setHours(0,0,0,0)).toISOString())}`, { token: SECRET })).data?.reduce((s,r)=>s+r.points,0) ?? 0;
console.log(`  accounts: ${beforeAccountCount}`);
console.log(`  touchpoints: ${beforeTpCount}`);
console.log(`  rep1 score_events today: ${beforeScoreToday} pts`);

header("Two-step convert (matches new FocusClient code)");
// Step A: convert WITHOUT log_touchpoint
const convRes = await rest(`/rest/v1/rpc/rpc_convert_prospect`, {
  token, method: "POST",
  body: {
    p_prospect_id: newProspect.data[0].id,
    p_account_name: `Smoke Test ${ts}`,
    p_account_type: "owner", p_account_website: null, p_account_phone: null, p_account_notes: null,
    p_create_contact: true,
    p_contact_full_name: null, p_contact_first_name: "Final", p_contact_last_name: "Test",
    p_contact_title: "Property Manager", p_contact_email: `final-${ts}@example.com`, p_contact_phone: "555-7777",
    p_create_property: false,
    p_property_address: null, p_property_city: null, p_property_state: null, p_property_postal_code: null,
    p_log_touchpoint: false,
    p_touchpoint_type_id: null, p_touchpoint_outcome_id: null, p_touchpoint_notes: null,
  },
});
console.log("  convert status:", convRes.status, "result:", convRes.raw);
if (!convRes.ok) { console.log("✗ convert failed"); process.exit(1); }
const conv = convRes.data;

// Step B: log touchpoint with returned ids
const tpRes = await rest(`/rest/v1/rpc/rpc_log_outreach_touchpoint`, {
  token, method: "POST",
  body: {
    p_contact_id: conv.contact_id,
    p_account_id: conv.account_id,
    p_touchpoint_type_id: callType.id,
    p_property_id: null,
    p_outcome_id: outcome.id,
    p_notes: `Focus session · Connected (smoke ${ts})`,
    p_engagement_phase: "first_touch",
  },
});
console.log("  touchpoint status:", tpRes.status);
console.log("  awarded_points:", (tpRes.data?.[0] ?? tpRes.data)?.awarded_points);

header("After snapshot");
const afterAccountCount = (await rest(`/rest/v1/accounts?select=id`, { token: SECRET })).data?.length ?? 0;
const afterTpCount = (await rest(`/rest/v1/touchpoints?select=id`, { token: SECRET })).data?.length ?? 0;
const afterScoreToday = (await rest(`/rest/v1/score_events?select=points&user_id=eq.${userId}&created_at=gte.${encodeURIComponent(new Date(new Date().setHours(0,0,0,0)).toISOString())}`, { token: SECRET })).data?.reduce((s,r)=>s+r.points,0) ?? 0;
console.log(`  accounts: ${afterAccountCount}  (Δ ${afterAccountCount-beforeAccountCount})`);
console.log(`  touchpoints: ${afterTpCount}  (Δ ${afterTpCount-beforeTpCount})`);
console.log(`  rep1 score_events today: ${afterScoreToday} pts  (Δ ${afterScoreToday-beforeScoreToday})`);

// Verify the prospect was marked converted via the suggestion side effect
const sugCheck = await rest(`/rest/v1/suggested_outreach?select=status&prospect_id=eq.${newProspect.data[0].id}`, { token: SECRET });
console.log(`  suggested_outreach.status: "${sugCheck.data?.[0]?.status}"`);

const newTp = await rest(`/rest/v1/touchpoints?select=id,rep_user_id,outcome_id,notes,happened_at&order=happened_at.desc&limit=1`, { token: SECRET });
console.log("  new touchpoint:", JSON.stringify(newTp.data?.[0], null, 2));

header("Leaderboard query (matches CompleteScreen useEffect)");
const ledger = await rest(`/rest/v1/score_events?select=user_id,points&created_at=gte.${encodeURIComponent(new Date(new Date().setHours(0,0,0,0)).toISOString())}`, { token });
const sums = new Map();
for (const r of (ledger.data ?? [])) sums.set(r.user_id, (sums.get(r.user_id) ?? 0) + r.points);
const sorted = [...sums.entries()].sort((a, b) => b[1] - a[1]);
sorted.forEach(([uid, pts], i) => console.log(`  #${i+1}  ${uid.slice(0,8)}  ${pts} pts ${uid===userId?"← rep1":""}`));
const myRank = sorted.findIndex(([u]) => u === userId);
console.log(`  rep1 rank: #${myRank+1} of ${sorted.length}`);
