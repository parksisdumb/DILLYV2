/**
 * Clear all agent-generated intel data from production.
 * Does NOT touch any org data, prospects, accounts, contacts, or main app tables.
 *
 * Usage: npx tsx scripts/clear-intel-data.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function countTable(table: string): Promise<number> {
  const { count } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  return count ?? 0;
}

async function main() {
  const tables = [
    "intel_prospects",
    "intel_entities",
    "intel_contacts",
    "intel_tenants",
    "agent_runs",
    "agent_registry",
  ];

  // Before counts
  console.log("=== BEFORE ===");
  for (const t of tables) {
    const count = await countTable(t);
    console.log(`  ${t}: ${count} rows`);
  }

  // Clear intel data via raw SQL
  console.log("\nClearing intel data...");

  // TRUNCATE via rpc or delete — supabase JS doesn't support TRUNCATE directly
  // Use delete with no filter to clear all rows

  // intel_contacts and intel_tenants reference intel_prospects/intel_entities, clear them first
  const { error: e1 } = await supabase.from("intel_contacts").delete().gte("created_at", "1970-01-01");
  if (e1) console.error("  intel_contacts delete error:", e1.message);
  else console.log("  intel_contacts: cleared");

  const { error: e2 } = await supabase.from("intel_tenants").delete().gte("created_at", "1970-01-01");
  if (e2) console.error("  intel_tenants delete error:", e2.message);
  else console.log("  intel_tenants: cleared");

  const { error: e3 } = await supabase.from("intel_prospects").delete().gte("created_at", "1970-01-01");
  if (e3) console.error("  intel_prospects delete error:", e3.message);
  else console.log("  intel_prospects: cleared");

  const { error: e4 } = await supabase.from("intel_entities").delete().gte("created_at", "1970-01-01");
  if (e4) console.error("  intel_entities delete error:", e4.message);
  else console.log("  intel_entities: cleared");

  const { error: e5 } = await supabase.from("agent_runs").delete().gte("started_at", "1970-01-01");
  if (e5) console.error("  agent_runs delete error:", e5.message);
  else console.log("  agent_runs: cleared");

  // Reset agent_registry stats (keep the entries)
  const { error: e6 } = await supabase
    .from("agent_registry")
    .update({
      last_run_at: null,
      run_count: 0,
      total_found: 0,
      total_inserted: 0,
    })
    .gte("created_at", "1970-01-01");
  if (e6) console.error("  agent_registry reset error:", e6.message);
  else console.log("  agent_registry: stats reset");

  // Reset config.last_offset and config.last_processed_cik for CMS and EDGAR
  const { data: registryRows } = await supabase.from("agent_registry").select("agent_name, config");
  for (const row of registryRows ?? []) {
    const config = (row.config as Record<string, unknown>) ?? {};
    delete config.last_offset;
    delete config.last_processed_cik;
    await supabase
      .from("agent_registry")
      .update({ config })
      .eq("agent_name", row.agent_name);
  }
  console.log("  agent_registry: config progress keys cleared");

  // After counts
  console.log("\n=== AFTER ===");
  for (const t of tables) {
    const count = await countTable(t);
    console.log(`  ${t}: ${count} rows`);
  }

  console.log("\nDone. Intel data cleared. Main app data untouched.");
}

main().catch(console.error);
