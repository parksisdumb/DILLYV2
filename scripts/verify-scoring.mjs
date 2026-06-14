// READ-ONLY verification after the scoring fix. SELECT-only.
// Usage: node scripts/verify-scoring.mjs [local|prod]
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

const which = process.argv[2] === "local" ? "local" : "prod";
config({ path: which === "local" ? ".env.local" : ".env.production" });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
console.log(`Target (${which}):`, process.env.NEXT_PUBLIC_SUPABASE_URL);

const { data: orgUsers } = await db.from("org_users").select("user_id,email,full_name,role");
const ouById = new Map((orgUsers ?? []).map((u) => [u.user_id, u]));

const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString();

// ---- PART 5: leaderboard — sum(points) per user, last 30 days ----
console.log("\n===== PART 5: points per user (last 30 days) =====");
const { data: se30, error } = await db
  .from("score_events")
  .select("user_id,points,created_at")
  .gte("created_at", thirtyAgo);
if (error) { console.error(error.message); process.exit(1); }
const sums = new Map();
for (const s of se30 ?? []) sums.set(s.user_id, (sums.get(s.user_id) ?? 0) + s.points);
const rows = [...sums.entries()].sort((a, b) => b[1] - a[1]);
if (!rows.length) console.log("  (no score_events in last 30 days)");
for (const [uid, pts] of rows) {
  const u = ouById.get(uid);
  console.log(`  ${String(pts).padStart(5)}  ${u ? (u.email ?? u.full_name) : uid}  [${u?.role ?? "?"}]`);
}

// ---- All-time points per user (completeness: every active rep scored) ----
console.log("\n===== All-time points per user (completeness) =====");
const { data: seAll } = await db.from("score_events").select("user_id,points");
const allSums = new Map();
for (const s of seAll ?? []) allSums.set(s.user_id, (allSums.get(s.user_id) ?? 0) + s.points);
for (const [uid, pts] of [...allSums.entries()].sort((a, b) => b[1] - a[1])) {
  const u = ouById.get(uid);
  console.log(`  ${String(pts).padStart(5)}  ${u ? (u.email ?? u.full_name) : uid}  [${u?.role ?? "?"}]`);
}

// ---- Double-score check: GROUP BY touchpoint_id HAVING count(*) > 1 ----
console.log("\n===== Double-score check (expect ZERO rows) =====");
const { data: allSe } = await db.from("score_events").select("touchpoint_id");
const counts = new Map();
for (const s of allSe ?? []) {
  if (!s.touchpoint_id) continue;
  counts.set(s.touchpoint_id, (counts.get(s.touchpoint_id) ?? 0) + 1);
}
const dups = [...counts.entries()].filter(([, c]) => c > 1);
if (!dups.length) console.log("  ✅ 0 touchpoints double-scored.");
else { console.log(`  ❌ ${dups.length} touchpoints double-scored:`); for (const [tid, c] of dups) console.log(`    ${tid}: ${c}`); }

console.log(`\n  total score_events: ${allSe?.length ?? 0}`);
console.log("DONE (read-only).");
process.exit(0);
