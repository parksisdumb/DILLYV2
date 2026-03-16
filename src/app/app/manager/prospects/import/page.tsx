import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import { normalizeDomain } from "@/lib/constants/prospect-fields";
import ImportWizardClient from "./import-wizard-client";

type TerritoryOption = { id: string; name: string };
type IcpOption = { id: string; name: string };
type BatchRow = {
  id: string;
  filename: string;
  row_count: number;
  duplicates_skipped: number;
  territory_name: string | null;
  created_at: string;
};

export default async function ImportPage() {
  const { supabase, userId, orgId } = await requireServerOrgContext();

  // role gate
  const { data: orgUser } = await supabase
    .from("org_users")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (!orgUser || !["manager", "admin"].includes(orgUser.role)) {
    redirect("/app");
  }

  const [territoryRes, icpRes, batchRes] = await Promise.all([
    supabase.from("territories").select("id,name").eq("active", true).order("name"),
    supabase.from("icp_profiles").select("id,name").eq("active", true).order("name"),
    supabase
      .from("import_batches")
      .select("id,filename,row_count,duplicates_skipped,territory_id,created_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const territories: TerritoryOption[] = (territoryRes.data ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
  }));
  const icpProfiles: IcpOption[] = (icpRes.data ?? []).map((i) => ({
    id: i.id as string,
    name: i.name as string,
  }));

  const territoryMap = new Map(territories.map((t) => [t.id, t.name]));
  const batches: BatchRow[] = (batchRes.data ?? []).map((b) => ({
    id: b.id as string,
    filename: b.filename as string,
    row_count: b.row_count as number,
    duplicates_skipped: b.duplicates_skipped as number,
    territory_name: territoryMap.get(b.territory_id as string) ?? null,
    created_at: b.created_at as string,
  }));

  // ── Server action: import prospects ──
  async function importAction(formData: FormData) {
    "use server";
    const { supabase: sb, userId: uid, orgId: oid } = await requireServerOrgContext();

    const rowsJson = String(formData.get("rows_json") ?? "[]");
    const territoryId = String(formData.get("territory_id") ?? "").trim() || null;
    const icpProfileId = String(formData.get("icp_profile_id") ?? "").trim() || null;
    const filename = String(formData.get("filename") ?? "import.csv").trim();

    let parsed: Record<string, string>[];
    try {
      parsed = JSON.parse(rowsJson);
    } catch {
      redirect("/app/manager/prospects/import?error=Invalid+data");
    }

    if (!parsed.length) {
      redirect("/app/manager/prospects/import?error=No+rows+to+import");
    }

    // Cap at 5000 rows
    if (parsed.length > 5000) {
      redirect("/app/manager/prospects/import?error=Maximum+5000+rows+per+import");
    }

    // Normalize domains and build dedup keys
    type ProspectInsert = Record<string, unknown>;
    const toInsert: ProspectInsert[] = [];
    const domainSet = new Set<string>();
    const addressSet = new Set<string>();

    for (const row of parsed) {
      const dn = normalizeDomain(row.website);
      const addrKey =
        row.address_line1 && row.postal_code
          ? `${row.postal_code.trim().toLowerCase()}|${row.address_line1.trim().toLowerCase()}`
          : null;

      toInsert.push({
        org_id: oid,
        company_name: row.company_name || "Unknown",
        website: row.website?.trim() || null,
        domain_normalized: dn,
        email: row.email?.trim() || null,
        phone: row.phone?.trim() || null,
        linkedin_url: row.linkedin_url?.trim() || null,
        address_line1: row.address_line1?.trim() || null,
        city: row.city?.trim() || null,
        state: row.state?.trim() || null,
        postal_code: row.postal_code?.trim() || null,
        account_type: row.account_type?.trim() || null,
        vertical: row.vertical?.trim() || null,
        contact_first_name: row.contact_first_name?.trim() || null,
        contact_last_name: row.contact_last_name?.trim() || null,
        contact_title: row.contact_title?.trim() || null,
        notes: row.notes?.trim() || null,
        territory_id: territoryId,
        icp_profile_id: icpProfileId,
        source: "csv_import",
        source_detail: filename,
        status: "unworked",
        created_by: uid,
      });

      if (dn) domainSet.add(dn);
      if (addrKey) addressSet.add(addrKey);
    }

    // Check existing duplicates by domain
    const existingDomains = new Set<string>();
    if (domainSet.size > 0) {
      const { data: domDupes } = await sb
        .from("prospects")
        .select("domain_normalized")
        .in("domain_normalized", [...domainSet]);
      for (const d of domDupes ?? []) {
        if (d.domain_normalized) existingDomains.add(d.domain_normalized as string);
      }
    }

    // Check existing duplicates by address
    const existingAddresses = new Set<string>();
    if (addressSet.size > 0) {
      const postalCodes = [...new Set(parsed.filter((r) => r.postal_code && r.address_line1).map((r) => r.postal_code.trim().toLowerCase()))];
      if (postalCodes.length > 0) {
        const { data: addrDupes } = await sb
          .from("prospects")
          .select("postal_code,address_line1")
          .in("postal_code", postalCodes);
        for (const a of addrDupes ?? []) {
          const key = `${(a.postal_code as string).toLowerCase()}|${(a.address_line1 as string).toLowerCase()}`;
          existingAddresses.add(key);
        }
      }
    }

    // Filter out duplicates
    const fresh: ProspectInsert[] = [];
    let dupeCount = 0;

    // Also track within-batch duplicates
    const seenDomains = new Set<string>();
    const seenAddresses = new Set<string>();

    for (const row of toInsert) {
      const dn = row.domain_normalized as string | null;
      const addrKey =
        row.address_line1 && row.postal_code
          ? `${(row.postal_code as string).toLowerCase()}|${(row.address_line1 as string).toLowerCase()}`
          : null;

      const domainDupe = dn && (existingDomains.has(dn) || seenDomains.has(dn));
      const addressDupe = addrKey && (existingAddresses.has(addrKey) || seenAddresses.has(addrKey));

      if (domainDupe || addressDupe) {
        dupeCount++;
      } else {
        fresh.push(row);
        if (dn) seenDomains.add(dn);
        if (addrKey) seenAddresses.add(addrKey);
      }
    }

    // Create batch record
    const { data: batch, error: batchErr } = await sb
      .from("import_batches")
      .insert({
        org_id: oid,
        filename,
        row_count: fresh.length,
        duplicates_skipped: dupeCount,
        territory_id: territoryId,
        icp_profile_id: icpProfileId,
        created_by: uid,
      })
      .select("id")
      .single();

    if (batchErr) {
      redirect(`/app/manager/prospects/import?error=${encodeURIComponent(batchErr.message)}`);
    }

    // Insert in chunks of 500
    const batchId = (batch as Record<string, unknown>).id as string;
    for (let i = 0; i < fresh.length; i += 500) {
      const chunk = fresh.slice(i, i + 500).map((r) => ({
        ...r,
        import_batch_id: batchId,
      }));
      const { error: insertErr } = await sb.from("prospects").insert(chunk);
      if (insertErr) {
        redirect(`/app/manager/prospects/import?error=${encodeURIComponent(insertErr.message)}`);
      }
    }

    revalidatePath("/app/manager/prospects/import");
    revalidatePath("/app/manager/prospects");
    redirect(`/app/manager/prospects?imported=${fresh.length}&skipped=${dupeCount}`);
  }

  return (
    <ImportWizardClient
      territories={territories}
      icpProfiles={icpProfiles}
      batches={batches}
      importAction={importAction}
    />
  );
}
