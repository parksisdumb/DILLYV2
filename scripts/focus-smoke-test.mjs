// LOCAL TESTING ONLY
// Hardcoded to local Supabase keys + rep1 credentials. Never run against production.
// Run: node scripts/focus-smoke-test.mjs
//
// Programmatic smoke test for Focus Mode.
// Replicates exactly what the FocusClient does: build the same queue, then
// for the first ~3 items call the same RPCs the UI calls, with rep1's auth.
// Snapshots touchpoints/score_events/accounts/suggested_outreach before+after.

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

async function rest(path, { token, body, method = "GET", headers = {} } = {}) {
  const url = `${URL}${path}`;
  const r = await fetch(url, {
    method,
    headers: {
      apikey: token === SECRET ? SECRET : ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: body ? "return=representation" : "return=representation",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { ok: r.ok, status: r.status, data: json, raw: text };
}

async function rpc(token, name, params) {
  return rest(`/rest/v1/rpc/${name}`, { token, body: params, method: "POST" });
}

async function login(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Login failed: ${JSON.stringify(j)}`);
  return j.access_token;
}

function trimRow(r, fields) {
  const out = {};
  for (const f of fields) out[f] = r[f];
  return out;
}

function header(label) {
  console.log("\n" + "═".repeat(70));
  console.log("  " + label);
  console.log("═".repeat(70));
}

(async () => {
  header("STEP 0 — Authenticate as rep1@dilly.dev");
  const token = await login("rep1@dilly.dev", "devpassword123!");
  console.log("✓ logged in (jwt length: " + token.length + ")");

  // Resolve rep1's user id
  const me = await rest("/rest/v1/org_users?select=user_id,org_id,role&limit=1", { token });
  if (!me.ok || !me.data?.length) { console.log("✗ org_users lookup failed:", me); return; }
  const { user_id: userId, org_id: orgId } = me.data[0];
  console.log(`  userId=${userId}`);
  console.log(`  orgId=${orgId}`);

  header("STEP 1 — Build Focus Mode queue (same query as focus/page.tsx)");

  const startOfTomorrow = new Date(); startOfTomorrow.setHours(0, 0, 0, 0); startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);

  // Source 1: open next_actions due today or earlier
  const naQ = `/rest/v1/next_actions?select=id,contact_id,account_id,property_id,due_at,notes&assigned_user_id=eq.${userId}&status=eq.open&contact_id=not.is.null&account_id=not.is.null&due_at=lt.${encodeURIComponent(startOfTomorrow.toISOString())}&order=due_at.asc`;
  const naRes = await rest(naQ, { token });
  console.log(`  follow_up source: ${naRes.data?.length ?? 0} next_actions due today-or-earlier`);

  // Source 2: suggested_outreach status='new' for this rep, joined to prospects
  const sugQ = `/rest/v1/suggested_outreach?select=id,prospect_id,rank_score,prospects(id,company_name,account_type,website,phone,email,address_line1,city,state,postal_code,contact_first_name,contact_last_name,contact_title,notes)&user_id=eq.${userId}&status=eq.new&order=rank_score.desc`;
  const sugRes = await rest(sugQ, { token });
  console.log(`  prospect source: ${sugRes.data?.length ?? 0} new suggested_outreach rows`);

  // Build queue items with sortKey (same encoding as page.tsx)
  const followUps = (naRes.data ?? []).map((q) => {
    const dueMs = new Date(q.due_at).getTime();
    const bucket = dueMs < startOfToday.getTime() ? "0" : "1";
    return {
      kind: "follow_up",
      sortKey: `${bucket}_${q.due_at}`,
      nextActionId: q.id,
      contactId: q.contact_id,
      accountId: q.account_id,
      propertyId: q.property_id,
      raw: q,
    };
  });
  const prospects = (sugRes.data ?? []).map((s, idx) => {
    const inv = String(999999 - Math.min(999999, Math.max(0, Math.floor(s.rank_score)))).padStart(6, "0");
    return {
      kind: "prospect",
      sortKey: `2_${inv}_${idx.toString().padStart(4, "0")}`,
      suggestionId: s.id,
      prospectId: s.prospect_id,
      prospect: s.prospects,
    };
  });
  const queue = [...followUps, ...prospects].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  console.log(`\n  combined queue (${queue.length} total):`);
  queue.slice(0, 10).forEach((it, i) => {
    const label = it.kind === "follow_up"
      ? `[FOLLOW_UP] na=${it.nextActionId.slice(0,8)} contact=${it.contactId.slice(0,8)} due=${it.raw.due_at.slice(0,10)}`
      : `[PROSPECT]  prospect=${it.prospectId.slice(0,8)} rank=${prospects.find(p=>p.prospectId===it.prospectId) ? sugRes.data.find(s=>s.prospect_id===it.prospectId).rank_score : '?'} company="${it.prospect?.company_name}"`;
    console.log(`    ${(i+1).toString().padStart(2)}. ${label}`);
  });
  if (queue.length === 0) {
    console.log("\n  ⚠️  Queue is empty — would redirect to /app/today. Smoke test cannot proceed.");
    console.log("     Re-run after seeding next_actions or suggested_outreach for rep1.");
    return;
  }

  header("STEP 2 — Resolve call type id + 'connected_conversation' outcome id");
  // Same lookup the page does: prefer org-specific call type, global outcome
  const ttRes = await rest(`/rest/v1/touchpoint_types?select=id,key,org_id&key=eq.call`, { token });
  const callType = (ttRes.data ?? []).find(t => t.org_id !== null) ?? (ttRes.data ?? []).find(t => t.org_id === null);
  const outRes = await rest(`/rest/v1/touchpoint_outcomes?select=id,key,org_id&key=eq.connected_conversation`, { token });
  const outcome = (outRes.data ?? []).find(o => o.org_id === null);
  console.log(`  call type id (org-specific):       ${callType?.id}`);
  console.log(`  connected_conversation outcome id: ${outcome?.id}`);
  if (!callType || !outcome) { console.log("✗ missing lookups"); return; }

  header("STEP 3 — Snapshot BEFORE (last 5 of each)");
  const beforeTps = await rest(`/rest/v1/touchpoints?select=id,contact_id,outcome_id,happened_at,notes&order=happened_at.desc&limit=5`, { token: SECRET });
  const beforeScores = await rest(`/rest/v1/score_events?select=id,user_id,points,created_at&order=created_at.desc&limit=5`, { token: SECRET });
  const beforeAccounts = await rest(`/rest/v1/accounts?select=id,name,created_at&order=created_at.desc&limit=5`, { token: SECRET });
  const beforeAccountCount = await rest(`/rest/v1/accounts?select=id`, { token: SECRET, headers: { Prefer: "count=exact" } });
  console.log("  recent touchpoints:");
  (beforeTps.data ?? []).forEach(t => console.log(`    - ${t.happened_at?.slice(0,19)} outcome=${(t.outcome_id??'').slice(0,8)} note="${(t.notes||'').slice(0,40)}"`));
  console.log("  recent score_events:");
  (beforeScores.data ?? []).forEach(s => console.log(`    - ${s.created_at?.slice(0,19)} +${s.points} user=${s.user_id?.slice(0,8)}`));
  console.log("  recent accounts:");
  (beforeAccounts.data ?? []).forEach(a => console.log(`    - ${a.created_at?.slice(0,19)} "${a.name}"`));
  console.log(`  total accounts: ${(beforeAccounts.data ?? []).length} shown (request count via headers if needed)`);

  header("STEP 4 — Walk through up to 3 items, simulating Connected outcome taps");

  const completed = [];
  for (let i = 0; i < Math.min(3, queue.length); i++) {
    const item = queue[i];
    console.log(`\n  Item ${i+1}/${Math.min(3,queue.length)} — kind=${item.kind}`);
    if (item.kind === "follow_up") {
      console.log(`    → calling rpc_log_outreach_touchpoint(contact=${item.contactId.slice(0,8)}, account=${item.accountId.slice(0,8)}, type=call, outcome=connected_conversation)`);
      const r = await rpc(token, "rpc_log_outreach_touchpoint", {
        p_contact_id: item.contactId,
        p_account_id: item.accountId,
        p_touchpoint_type_id: callType.id,
        p_property_id: item.propertyId,
        p_outcome_id: outcome.id,
        p_notes: "Smoke test · Connected",
        p_engagement_phase: "follow_up",
      });
      if (!r.ok) { console.log(`    ✗ RPC error (${r.status}):`, r.raw); continue; }
      const row = Array.isArray(r.data) ? r.data[0] : r.data;
      console.log(`    ✓ touchpoint_id=${(row?.touchpoint_id ?? '').slice(0,8)} awarded_points=${row?.awarded_points}`);
      // Mark next_action complete (same as the UI does)
      const upd = await rest(`/rest/v1/next_actions?id=eq.${item.nextActionId}&status=eq.open`, {
        token, method: "PATCH",
        body: { status: "completed", ...(row?.touchpoint_id ? { completed_by_touchpoint_id: row.touchpoint_id } : {}) },
      });
      console.log(`    ↳ next_action update: status=${upd.status}`);
      completed.push({ kind: "follow_up", points: row?.awarded_points ?? 0 });
    } else {
      const p = item.prospect;
      const hasName = Boolean(((p?.contact_first_name)||"").trim() || ((p?.contact_last_name)||"").trim());
      console.log(`    → calling rpc_convert_prospect(prospect=${item.prospectId.slice(0,8)}, account_name="${p?.company_name}", create_contact=${hasName}, log_touchpoint=${hasName})`);
      const r = await rpc(token, "rpc_convert_prospect", {
        p_prospect_id: item.prospectId,
        p_account_name: p?.company_name,
        p_account_type: p?.account_type ?? null,
        p_account_website: p?.website ?? null,
        p_account_phone: p?.phone ?? null,
        p_account_notes: null,
        p_create_contact: hasName,
        p_contact_full_name: null,
        p_contact_first_name: p?.contact_first_name ?? null,
        p_contact_last_name: p?.contact_last_name ?? null,
        p_contact_title: p?.contact_title ?? null,
        p_contact_email: p?.email ?? null,
        p_contact_phone: p?.phone ?? null,
        p_create_property: false,
        p_property_address: null, p_property_city: null, p_property_state: null, p_property_postal_code: null,
        p_log_touchpoint: hasName,
        p_touchpoint_type_id: hasName ? callType.id : null,
        p_touchpoint_outcome_id: hasName ? outcome.id : null,
        p_touchpoint_notes: "Smoke test · Connected",
      });
      if (!r.ok) { console.log(`    ✗ RPC error (${r.status}):`, r.raw); continue; }
      const data = r.data;
      console.log(`    ✓ account_id=${(data?.account_id ?? '').slice(0,8)} contact_id=${(data?.contact_id ?? '?').slice(0,8)} touchpoint_id=${(data?.touchpoint_id ?? '?').slice(0,8)}`);

      // Verify suggested_outreach status flipped
      const sugCheck = await rest(`/rest/v1/suggested_outreach?select=status&id=eq.${item.suggestionId}`, { token: SECRET });
      console.log(`    ↳ suggested_outreach.status now: "${sugCheck.data?.[0]?.status}"`);
      completed.push({ kind: "prospect", points: hasName ? 3 : 0 });
    }
  }

  header("STEP 5 — Snapshot AFTER (last 5 of each)");
  const afterTps = await rest(`/rest/v1/touchpoints?select=id,contact_id,outcome_id,happened_at,notes&order=happened_at.desc&limit=5`, { token: SECRET });
  const afterScores = await rest(`/rest/v1/score_events?select=id,user_id,points,created_at&order=created_at.desc&limit=5`, { token: SECRET });
  const afterAccounts = await rest(`/rest/v1/accounts?select=id,name,created_at&order=created_at.desc&limit=5`, { token: SECRET });
  console.log("  recent touchpoints:");
  (afterTps.data ?? []).forEach(t => console.log(`    - ${t.happened_at?.slice(0,19)} outcome=${(t.outcome_id??'').slice(0,8)} note="${(t.notes||'').slice(0,40)}"`));
  console.log("  recent score_events:");
  (afterScores.data ?? []).forEach(s => console.log(`    - ${s.created_at?.slice(0,19)} +${s.points} user=${s.user_id?.slice(0,8)}`));
  console.log("  recent accounts:");
  (afterAccounts.data ?? []).forEach(a => console.log(`    - ${a.created_at?.slice(0,19)} "${a.name}"`));

  header("STEP 6 — Simulated Complete-screen leaderboard query");
  const ledger = await rest(`/rest/v1/score_events?select=user_id,points&created_at=gte.${encodeURIComponent(startOfToday.toISOString())}`, { token });
  const sums = new Map();
  for (const r of (ledger.data ?? [])) sums.set(r.user_id, (sums.get(r.user_id) ?? 0) + r.points);
  const sorted = [...sums.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  total reps with points today: ${sorted.length}`);
  sorted.forEach(([uid, pts], i) => {
    const me = uid === userId ? "  ← rep1" : "";
    console.log(`    #${i+1}  ${uid.slice(0,8)}  ${pts} pts${me}`);
  });
  const myRank = sorted.findIndex(([u]) => u === userId);
  if (myRank >= 0) console.log(`  rep1's rank today: #${myRank+1} of ${sorted.length}`);

  header("RESULT");
  const totalPoints = completed.reduce((s, c) => s + c.points, 0);
  console.log(`  Items processed: ${completed.length}`);
  console.log(`  Session points (sum of awarded_points): ${totalPoints}`);
  console.log(`  Done.`);
})();
