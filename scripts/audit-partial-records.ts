/**
 * Read-only audit: records stranded by an abandoned create.
 *
 * Context: reps hitting the property "possible duplicate" wall could abandon a
 * half-finished create. This looks for the debris that would leave behind:
 *
 *   A. Accounts with no property, no contact and no touchpoint (Quick Log / Grow
 *      create the account BEFORE the property + touchpoint, non-atomically, so an
 *      abandoned or failed save after step 1 strands the account).
 *   B. Properties with no primary_account_id (a property whose account link failed).
 *   C. Properties sharing a normalized address key (the duplicates the warning is
 *      meant to prevent) — reported for visibility, NOT auto-merged.
 *
 * Writes nothing. Run:
 *   npx tsx --env-file=.env.production.local scripts/audit-partial-records.ts
 *   npx tsx --env-file=.env.production.local scripts/audit-partial-records.ts --org "FOX"
 */
import { createClient } from "@supabase/supabase-js";
import { propertyDuplicateKey } from "../src/lib/address";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const orgFilterIdx = process.argv.indexOf("--org");
const orgFilter = orgFilterIdx > -1 ? process.argv[orgFilterIdx + 1] : null;

const { data: orgs, error: orgErr } = await db.from("orgs").select("id,name");
if (orgErr) throw orgErr;
const targets = orgFilter
  ? orgs.filter((o) => (o.name ?? "").toLowerCase().includes(orgFilter.toLowerCase()))
  : orgs;

const { data: people } = await db.from("org_users").select("user_id,full_name,email");
const who = (id: string | null) => {
  const p = people?.find((u) => u.user_id === id);
  return p ? (p.full_name || p.email || id) : (id ?? "—");
};

for (const org of targets) {
  console.log(`\n═══ ${org.name} (${org.id}) ═══`);

  const [{ data: accounts }, { data: properties }, { data: contacts }, { data: touchpoints }] =
    await Promise.all([
      db.from("accounts").select("id,name,created_by,created_at,notes").eq("org_id", org.id).is("deleted_at", null),
      db.from("properties").select("id,name,address_line1,address_line2,city,state,primary_account_id,created_by,created_at").eq("org_id", org.id).is("deleted_at", null),
      db.from("contacts").select("id,account_id").eq("org_id", org.id).is("deleted_at", null),
      db.from("touchpoints").select("id,account_id,property_id,contact_id,happened_at").eq("org_id", org.id),
    ]);

  const propAccounts = new Set((properties ?? []).map((p) => p.primary_account_id).filter(Boolean));
  const contactAccounts = new Set((contacts ?? []).map((c) => c.account_id).filter(Boolean));
  const touchAccounts = new Set((touchpoints ?? []).map((t) => t.account_id).filter(Boolean));

  // A. Stranded accounts
  const stranded = (accounts ?? []).filter(
    (a) => !propAccounts.has(a.id) && !contactAccounts.has(a.id) && !touchAccounts.has(a.id),
  );
  console.log(`\nA. Accounts with no property, no contact, no touchpoint: ${stranded.length}`);
  for (const a of stranded) {
    console.log(`   ${a.created_at?.slice(0, 10)}  ${a.name ?? "(unnamed)"}  by ${who(a.created_by)}  id=${a.id}`);
  }

  // B. Properties with no account link
  const orphanProps = (properties ?? []).filter((p) => !p.primary_account_id);
  console.log(`\nB. Properties with no primary account: ${orphanProps.length}`);
  for (const p of orphanProps) {
    console.log(`   ${p.created_at?.slice(0, 10)}  ${p.name ?? p.address_line1}  by ${who(p.created_by)}  id=${p.id}`);
  }

  // C. Normalized-address collisions
  const groups = new Map();
  for (const p of properties ?? []) {
    const k = propertyDuplicateKey(p.address_line1, p.city);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const collisions = [...groups.entries()].filter(([, rows]) => rows.length > 1);
  console.log(`\nC. Normalized-address collisions: ${collisions.length} group(s)`);
  for (const [k, rows] of collisions) {
    console.log(`   ${k}`);
    for (const p of rows) {
      const unit = [p.address_line1, p.address_line2].filter(Boolean).join(" | ");
      console.log(`      ${p.created_at?.slice(0, 10)}  ${p.name ?? "(unnamed)"}  ${unit}  by ${who(p.created_by)}  id=${p.id}`);
    }
  }
}

console.log("\nDone. Nothing was written.");
