// CMS Healthcare Facility Source
// Fetches Medicare-certified hospital data from the CMS Hospital General Information API.
// Endpoint: xubh-q36u (Hospital General Information)
// ~5,400 facilities with verified addresses, ownership, and type.

import { createAdminClient } from "@/lib/supabase/admin";

type SourceResult = {
  found: number;
  added: number;
  skipped: number;
  debug?: string[];
  dryRun?: boolean;
};

const CMS_API_URL =
  "https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0";
const BATCH_SIZE = 5000;

// Re-use the shared insert helper — imported at call site, passed in
type InsertFn = (
  supabase: ReturnType<typeof createAdminClient>,
  prospect: Record<string, unknown>
) => Promise<"added" | "skipped" | "error">;

export async function sourceCmsHealthcare(
  supabase: ReturnType<typeof createAdminClient>,
  agentRunId: string,
  insertIntelProspect: InsertFn,
  isCapReached: () => boolean,
  dryRun = false
): Promise<SourceResult> {
  const result: SourceResult = { found: 0, added: 0, skipped: 0 };
  const log: string[] = [];

  try {
    log.push("Starting CMS Healthcare pipeline");

    // Load progress from agent_registry
    const { data: registry } = await supabase
      .from("agent_registry")
      .select("config")
      .eq("agent_name", "cms_healthcare")
      .single();

    const config = (registry?.config as Record<string, unknown>) ?? {};
    const lastOffset = (config.last_offset as number) ?? 0;

    // Fetch a batch from CMS
    const offset = lastOffset;
    const url = `${CMS_API_URL}?limit=${BATCH_SIZE}&offset=${offset}`;
    log.push(`Fetching CMS data: offset=${offset}, limit=${BATCH_SIZE}`);

    const resp = await fetch(url);
    if (!resp.ok) {
      log.push(`CMS API failed: ${resp.status} ${resp.statusText}`);
      return { ...result, debug: log, dryRun };
    }

    const data = (await resp.json()) as {
      results: Record<string, string>[];
      count: number;
    };

    const totalCount = data.count ?? 0;
    const facilities = data.results ?? [];
    log.push(`CMS returned ${facilities.length} facilities (${totalCount} total in dataset)`);

    if (facilities.length === 0) {
      log.push("No facilities in this batch, resetting offset to 0");
      await supabase
        .from("agent_registry")
        .update({ config: { ...config, last_offset: 0 } })
        .eq("agent_name", "cms_healthcare");
      return { ...result, debug: log, dryRun };
    }

    for (const fac of facilities) {
      if (isCapReached()) {
        log.push("Global insert cap reached, stopping");
        break;
      }

      const name = fac.facility_name ?? "";
      const address = fac.address ?? "";
      const city = fac.citytown ?? "";
      const state = fac.state ?? "";
      const zip = fac.zip_code ?? "";
      const phone = fac.telephone_number ?? "";
      const hospitalType = fac.hospital_type ?? "";
      const ownership = fac.hospital_ownership ?? "";

      if (!name) continue;

      // Confidence scoring — CMS is verified government data
      let score = 30; // base
      if (address) score += 15;
      if (zip) score += 10;
      score = Math.min(100, score);

      result.found++;

      if (score < 25) {
        result.skipped++;
        continue;
      }

      if (!dryRun) {
        const status = await insertIntelProspect(supabase, {
          company_name: name,
          domain_normalized: null,
          address_line1: address || null,
          city: city || null,
          state: state || null,
          postal_code: zip || null,
          building_type: "healthcare",
          account_type: "owner",
          vertical: "healthcare",
          facility_type: hospitalType || null,
          confidence_score: score,
          source: "agent",
          source_detail: "cms_healthcare",
          agent_run_id: agentRunId,
          agent_metadata: {
            facility_id: fac.facility_id,
            hospital_type: hospitalType,
            ownership,
            phone,
          },
        });

        if (status === "added") result.added++;
        else if (status === "skipped") result.skipped++;
      } else {
        log.push(
          `[DRY RUN] Would insert: ${name} | ${city}, ${state} ${zip} | ${hospitalType} (score=${score})`
        );
        result.added++;
      }
    }

    // Save progress
    const nextOffset =
      facilities.length < BATCH_SIZE ? 0 : offset + facilities.length;

    if (!dryRun) {
      await supabase
        .from("agent_registry")
        .update({
          config: { ...config, last_offset: nextOffset },
          last_run_at: new Date().toISOString(),
          total_found: result.found,
          total_inserted: result.added,
        })
        .eq("agent_name", "cms_healthcare");
      log.push(`Progress saved: next_offset=${nextOffset}`);
    }

    log.push(
      `Done: found=${result.found} added=${result.added} skipped=${result.skipped}`
    );
    return { ...result, debug: log, dryRun };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.push(`FATAL: ${msg}`);
    return { ...result, debug: log, dryRun };
  }
}
