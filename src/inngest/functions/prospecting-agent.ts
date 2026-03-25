import { inngest } from "../client";
import { createAdminClient } from "@/lib/supabase/admin";
import Anthropic from "@anthropic-ai/sdk";
import { scoreWithSource } from "@/lib/intel/confidence";
import {
  safeParseJsonArray,
  safeParseJsonObject,
  normalizeDomain,
  callClaude,
  parseAddress,
  delay,
} from "@/lib/intel/utils";

// ── Types ────────────────────────────────────────────────────────────────────

type SourceResult = {
  found: number;
  added: number;
  skipped: number;
  debug?: string[];
  dryRun?: boolean;
};

type RawProspect = {
  company_name: string;
  company_website?: string;
  company_phone?: string;
  address_line1?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  lat?: number;
  lng?: number;
  building_type?: string;
  building_sq_footage?: number;
  account_type?: string;
  vertical?: string;
  contact_first_name?: string;
  contact_last_name?: string;
  contact_title?: string;
  contact_email?: string;
  contact_phone?: string;
  owner_name_legal?: string;
};

// ── Global insertion cap ─────────────────────────────────────────────────────

const MAX_INSERTS_PER_RUN = 50;
let globalInsertCount = 0;

function isCapReached(): boolean {
  return globalInsertCount >= MAX_INSERTS_PER_RUN;
}

// ── Helper: insert into intel_prospects with dedup ───────────────────────────

async function insertIntelProspect(
  supabase: ReturnType<typeof createAdminClient>,
  prospect: Record<string, unknown>
): Promise<"added" | "skipped" | "error"> {
  if (isCapReached()) return "skipped";

  const { error } = await supabase.from("intel_prospects").insert(prospect);

  if (!error) {
    globalInsertCount++;
    return "added";
  }
  if (error.code === "23505" || error.message?.includes("unique")) return "skipped";
  console.error("[agent] insert error:", error.message);
  return "error";
}

// ── EDGAR Pipeline (modular — uses step files) ──────────────────────────────

import { getReitUniverse } from "@/lib/intel/edgar-reit-universe";
import { get10KDocumentUrl } from "@/lib/intel/edgar-filing-fetcher";
import { extractItem2Properties } from "@/lib/intel/edgar-item2-extractor";
import { sourceCmsHealthcare } from "@/lib/intel/source-cms-healthcare";
const EDGAR_BATCH_SIZE = 50;

async function sourceEdgar(
  supabase: ReturnType<typeof createAdminClient>,
  _anthropic: Anthropic,
  agentRunId: string,
  dryRun = false
): Promise<SourceResult> {
  const result: SourceResult = { found: 0, added: 0, skipped: 0 };
  const log: string[] = [];

  try {
    log.push("Starting EDGAR pipeline (modular, batched)");

    // Load agent_registry config for progress tracking
    const { data: registry } = await supabase
      .from("agent_registry")
      .select("config")
      .eq("agent_name", "edgar_10k")
      .single();

    const config = (registry?.config as Record<string, unknown>) ?? {};
    const lastProcessedCik = (config.last_processed_cik as string) ?? null;
    const universeRefreshedAt = config.universe_refreshed_at as string | null;

    // Decide whether to force-refresh the universe
    // Refresh if never refreshed, or if it's been more than 30 days
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const needsRefresh =
      !universeRefreshedAt ||
      Date.now() - new Date(universeRefreshedAt).getTime() > thirtyDaysMs;

    log.push(
      `Config: lastProcessedCik=${lastProcessedCik ?? "none"}, ` +
        `universeRefreshed=${universeRefreshedAt ?? "never"}, ` +
        `needsRefresh=${needsRefresh}`
    );

    // Step 1: Get REIT universe (cached or fresh)
    const reits = await getReitUniverse(needsRefresh);
    log.push(`Step 1: ${reits.length} REITs in universe`);

    if (reits.length === 0) {
      log.push("No REITs found, stopping");
      return { ...result, debug: log, dryRun };
    }

    // Update universe_refreshed_at if we refreshed
    if (needsRefresh) {
      await supabase
        .from("agent_registry")
        .update({
          config: { ...config, universe_refreshed_at: new Date().toISOString() },
        })
        .eq("agent_name", "edgar_10k");
    }

    // Step 2: Pick the batch — resume from where last run stopped
    let startIdx = 0;
    if (lastProcessedCik) {
      const lastIdx = reits.findIndex((r) => r.cik === lastProcessedCik);
      if (lastIdx !== -1) {
        startIdx = lastIdx + 1;
      }
      // If past the end, wrap around
      if (startIdx >= reits.length) {
        startIdx = 0;
        log.push("Wrapped around to beginning of universe");
      }
    }

    const batch = reits.slice(startIdx, startIdx + EDGAR_BATCH_SIZE);
    // If batch is shorter than EDGAR_BATCH_SIZE and we didn't start at 0,
    // wrap around and fill the remainder
    const wrapCount = Math.max(0, EDGAR_BATCH_SIZE - batch.length);
    if (wrapCount > 0 && startIdx > 0) {
      batch.push(...reits.slice(0, Math.min(wrapCount, startIdx)));
    }

    log.push(
      `Batch: ${batch.length} REITs starting at index ${startIdx} ` +
        `(${batch[0]?.name} → ${batch[batch.length - 1]?.name})`
    );

    // Step 3: Process each REIT in the batch
    let lastCikProcessed = lastProcessedCik;

    for (const reit of batch) {
      if (isCapReached()) {
        log.push("Global insert cap reached, stopping early");
        break;
      }

      lastCikProcessed = reit.cik;

      log.push(`Fetching filing for ${reit.name} (${reit.ticker}, CIK ${reit.cik})`);
      const documentUrl = await get10KDocumentUrl(reit.cik, reit.name);

      if (!documentUrl) {
        log.push(`SKIPPED: ${reit.name} — no 10-K document found`);
        continue;
      }

      log.push(`Document: ${documentUrl}`);

      const properties = await extractItem2Properties(documentUrl, reit.name);
      log.push(`Found ${properties.length} properties from ${reit.name}`);

      for (const prop of properties) {
        if (isCapReached()) break;

        let score = 20;
        if (prop.address) score += 15;
        if (prop.state) score += 10;
        if (prop.property_type !== "unknown") score += 10;
        if (prop.sq_footage) score += 10;
        score += Math.min(30, Math.max(0, prop.confidence_boost));
        score = Math.min(100, score);

        result.found++;

        if (score < 25) {
          result.skipped++;
          continue;
        }

        if (!dryRun) {
          const status = await insertIntelProspect(supabase, {
            company_name: reit.name,
            domain_normalized: null,
            address_line1: prop.address || null,
            city: prop.city || null,
            state: prop.state || null,
            postal_code: prop.zip || null,
            building_type: prop.property_type || null,
            building_sq_footage: prop.sq_footage || null,
            account_type: "owner",
            vertical: "commercial_real_estate",
            owner_name_legal: reit.name,
            confidence_score: score,
            source: "agent",
            source_detail: "edgar_10k",
            agent_run_id: agentRunId,
            agent_metadata: {
              cik: reit.cik,
              ticker: reit.ticker,
              tenant: prop.tenant,
            },
          });

          if (status === "added") result.added++;
          else if (status === "skipped") result.skipped++;
        } else {
          log.push(`[DRY RUN] Would insert: ${prop.city}, ${prop.state} - ${prop.property_type} (score=${score})`);
          result.added++;
        }
      }
    }

    // Save progress: update last_processed_cik and run stats
    if (lastCikProcessed && !dryRun) {
      const updatedConfig = {
        ...config,
        last_processed_cik: lastCikProcessed,
        universe_refreshed_at:
          config.universe_refreshed_at ?? new Date().toISOString(),
      };
      await supabase
        .from("agent_registry")
        .update({
          config: updatedConfig,
          last_run_at: new Date().toISOString(),
          run_count: (registry?.config as Record<string, unknown>)?.run_count
            ? undefined
            : undefined, // let DB handle increment
          total_found: result.found,
          total_inserted: result.added,
        })
        .eq("agent_name", "edgar_10k");

      log.push(`Progress saved: last_processed_cik=${lastCikProcessed}`);
    }

    log.push(
      `Done: found=${result.found} added=${result.added} skipped=${result.skipped}, ` +
        `batch=${batch.length}/${reits.length} total REITs`
    );
    return { ...result, debug: log, dryRun };

  } catch (outerErr) {
    const msg = outerErr instanceof Error ? outerErr.message : String(outerErr);
    log.push(`FATAL: ${msg}`);
    return { ...result, debug: log, dryRun };
  }
}

// ── Google Places Source (global — broad commercial queries) ──────────────────

async function sourceGooglePlaces(
  supabase: ReturnType<typeof createAdminClient>,
  agentRunId: string
): Promise<SourceResult> {
  const result: SourceResult = { found: 0, added: 0, skipped: 0 };
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    console.log("[places] GOOGLE_PLACES_API_KEY not set, skipping");
    return result;
  }

  // Global search across major US commercial markets
  const markets = [
    { city: "Memphis", state: "TN" },
    { city: "Nashville", state: "TN" },
    { city: "Atlanta", state: "GA" },
    { city: "Dallas", state: "TX" },
    { city: "Houston", state: "TX" },
    { city: "Phoenix", state: "AZ" },
    { city: "Charlotte", state: "NC" },
    { city: "Tampa", state: "FL" },
    { city: "Denver", state: "CO" },
    { city: "Indianapolis", state: "IN" },
  ];

  const queryTemplates = [
    "commercial property management",
    "commercial building owner",
  ];

  console.log(`[places] Processing ${markets.length} markets (cap: ${MAX_INSERTS_PER_RUN} inserts)`);

  for (const { city, state } of markets) {
    if (isCapReached()) {
      console.log(`[places] Global insert cap reached (${globalInsertCount}/${MAX_INSERTS_PER_RUN}), stopping`);
      break;
    }
    for (const template of queryTemplates) {
      if (isCapReached()) break;
      const query = `${template} ${city} ${state}`;
      try {
        const resp = await fetch(
          "https://places.googleapis.com/v1/places:searchText",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": apiKey,
              "X-Goog-FieldMask":
                "places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.location,places.types",
            },
            body: JSON.stringify({ textQuery: query, maxResultCount: 20 }),
          }
        );

        if (!resp.ok) {
          console.error(`[places] API error ${resp.status}: ${await resp.text()}`);
          continue;
        }

        const data = (await resp.json()) as {
          places?: {
            displayName?: { text: string };
            formattedAddress?: string;
            nationalPhoneNumber?: string;
            websiteUri?: string;
            location?: { latitude: number; longitude: number };
            types?: string[];
          }[];
        };

        const places = data.places ?? [];
        console.log(`[places] "${query}": ${places.length} results`);

        for (const place of places) {
          const companyName = place.displayName?.text;
          if (!companyName) continue;

          const addr = parseAddress(place.formattedAddress ?? "");
          const domain = normalizeDomain(place.websiteUri);

          const prospect: RawProspect = {
            company_name: companyName,
            company_website: place.websiteUri ?? undefined,
            company_phone: place.nationalPhoneNumber ?? undefined,
            address_line1: addr.address_line1 ?? undefined,
            city: addr.city ?? city,
            state: addr.state ?? state,
            postal_code: addr.postal_code ?? undefined,
            lat: place.location?.latitude,
            lng: place.location?.longitude,
            account_type: "commercial_property_management",
          };

          const { score, breakdown } = scoreWithSource("google_places", prospect);
          result.found++;

          const status = await insertIntelProspect(supabase, {
            company_name: prospect.company_name,
            company_website: prospect.company_website || null,
            company_phone: prospect.company_phone || null,
            domain_normalized: domain,
            address_line1: prospect.address_line1 || null,
            city: prospect.city || null,
            state: prospect.state || null,
            postal_code: prospect.postal_code || null,
            lat: prospect.lat ?? null,
            lng: prospect.lng ?? null,
            account_type: prospect.account_type,
            confidence_score: score,
            score_breakdown: breakdown,
            source: "agent",
            source_detail: "google_places",
            agent_run_id: agentRunId,
            agent_metadata: { place_types: place.types, query },
          });

          if (status === "added") result.added++;
          else if (status === "skipped") result.skipped++;
        }
      } catch (err) {
        console.error(`[places] Error for "${query}":`, err);
      }

      await delay(200);
    }
  }

  console.log(`[places] Done: found=${result.found} added=${result.added} skipped=${result.skipped}`);
  return result;
}

// ── Web Intelligence Source (global — broad commercial queries) ───────────────

async function sourceWebIntelligence(
  supabase: ReturnType<typeof createAdminClient>,
  anthropic: Anthropic,
  agentRunId: string
): Promise<SourceResult> {
  const result: SourceResult = { found: 0, added: 0, skipped: 0 };

  // Broad commercial real estate searches across markets
  const searches = [
    "largest commercial property management companies southeast United States",
    "top commercial REIT property portfolios Tennessee",
    "industrial warehouse property owners Memphis Nashville",
    "commercial building owners Atlanta Charlotte",
    "retail strip center property managers Texas",
  ];

  console.log(`[web-intel] Running ${searches.length} global searches (cap: ${MAX_INSERTS_PER_RUN}, current: ${globalInsertCount})`);

  for (const query of searches) {
    if (isCapReached()) {
      console.log(`[web-intel] Global insert cap reached (${globalInsertCount}/${MAX_INSERTS_PER_RUN}), stopping`);
      break;
    }
    try {
      console.log(`[web-intel] Searching: "${query}"`);

      const claudeResult = await callClaude(
        anthropic,
        `You are a commercial real estate researcher. Search the web for the given query and extract business information. Return ONLY a valid JSON array of objects with fields: company_name, address_line1, city, state, postal_code, website, phone, contact_name, contact_title, contact_email, account_type, vertical. Return [] if nothing found.`,
        `Search for: ${query}\n\nFind real commercial property companies, building owners, and property management firms. Extract their business details. Return results as a JSON array.`,
        4096,
        [
          {
            type: "web_search_20250305" as unknown as "custom",
            name: "web_search",
          } as unknown as Anthropic.Messages.Tool,
        ]
      );

      const prospects = safeParseJsonArray(claudeResult);
      console.log(`[web-intel] "${query}": ${prospects.length} results`);

      for (const p of prospects) {
        const companyName = String(p.company_name ?? "");
        if (!companyName) continue;

        const domain = normalizeDomain(String(p.website ?? p.company_website ?? ""));
        const contactName = String(p.contact_name ?? "");
        const nameParts = contactName.split(/\s+/);

        const prospect: RawProspect = {
          company_name: companyName,
          company_website: String(p.website ?? ""),
          company_phone: String(p.phone ?? ""),
          address_line1: String(p.address_line1 ?? ""),
          city: String(p.city ?? ""),
          state: String(p.state ?? ""),
          postal_code: String(p.postal_code ?? ""),
          contact_first_name: nameParts.length > 0 ? nameParts[0] : undefined,
          contact_last_name: nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined,
          contact_title: String(p.contact_title ?? ""),
          contact_email: String(p.contact_email ?? ""),
          account_type: String(p.account_type ?? ""),
          vertical: String(p.vertical ?? ""),
        };

        const { score, breakdown } = scoreWithSource("web_intelligence", prospect);
        result.found++;

        const status = await insertIntelProspect(supabase, {
          company_name: prospect.company_name,
          company_website: prospect.company_website || null,
          company_phone: prospect.company_phone || null,
          domain_normalized: domain,
          address_line1: prospect.address_line1 || null,
          city: prospect.city || null,
          state: prospect.state || null,
          postal_code: prospect.postal_code || null,
          contact_first_name: prospect.contact_first_name || null,
          contact_last_name: prospect.contact_last_name || null,
          contact_title: prospect.contact_title || null,
          contact_email: prospect.contact_email || null,
          account_type: prospect.account_type || null,
          vertical: prospect.vertical || null,
          confidence_score: score,
          score_breakdown: breakdown,
          source: "agent",
          source_detail: "web_intelligence",
          agent_run_id: agentRunId,
          agent_metadata: { query },
        });

        if (status === "added") result.added++;
        else if (status === "skipped") result.skipped++;
      }
    } catch (err) {
      console.error(`[web-intel] Error for "${query}":`, err);
    }
  }

  console.log(`[web-intel] Done: found=${result.found} added=${result.added} skipped=${result.skipped}`);
  return result;
}

// ── Main Inngest Function (global — no org context) ──────────────────────────

export const prospectingAgent = inngest.createFunction(
  {
    id: "prospecting-agent",
    retries: 1,
    triggers: [
      { event: "app/prospecting-agent.run" },
      { cron: "0 2 * * 0" }, // Every Sunday at 2am UTC
    ],
  },
  async ({ step }) => {
    const supabase = createAdminClient();
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Reset global insert counter for this run
    globalInsertCount = 0;

    let runId: string | null = null;
    let errorMessage: string | null = null;
    const edgarResult: SourceResult = { found: 0, added: 0, skipped: 0 };
    const cmsResult: SourceResult = { found: 0, added: 0, skipped: 0 };
    const placesResult: SourceResult = { found: 0, added: 0, skipped: 0 };
    const webResult: SourceResult = { found: 0, added: 0, skipped: 0 };

    try {
      // ── Step: Setup ──────────────────────────────────────────────────────
      runId = await step.run("setup", async () => {
        console.log("[agent] Starting global prospecting agent");

        const { data: firstOrg } = await supabase
          .from("orgs")
          .select("id")
          .limit(1)
          .single();

        const { data: run, error: runErr } = await supabase
          .from("agent_runs")
          .insert({
            org_id: firstOrg?.id,
            run_type: "prospecting",
            status: "running",
            started_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (runErr || !run) {
          console.error("[agent] Failed to create agent_runs:", runErr);
          throw new Error("Failed to create agent_runs record");
        }

        return run.id as string;
      });

      // ── Step: EDGAR ──────────────────────────────────────────────────────
      const er = await step.run("source-edgar", async () => {
        return sourceEdgar(supabase, anthropic, runId!);
      });
      Object.assign(edgarResult, er);

      // ── Step: CMS Healthcare ─────────────────────────────────────────────
      const cr = await step.run("source-cms-healthcare", async () => {
        return sourceCmsHealthcare(supabase, runId!, insertIntelProspect, isCapReached);
      });
      Object.assign(cmsResult, cr);

      // ── Step: Google Places ───────────────────────────────────────────────
      const pr = await step.run("source-google-places", async () => {
        return sourceGooglePlaces(supabase, runId!);
      });
      Object.assign(placesResult, pr);

      // ── Step: Web Intelligence ───────────────────────────────────────────
      const wr = await step.run("source-web-intelligence", async () => {
        return sourceWebIntelligence(supabase, anthropic, runId!);
      });
      Object.assign(webResult, wr);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      console.error("[agent] Agent run failed:", errorMessage);
    } finally {
      // Always finalize — even on timeout/cancel
      if (runId) {
        await step.run("finalize", async () => {
          const totalFound = edgarResult.found + cmsResult.found + placesResult.found + webResult.found;
          const totalAdded = edgarResult.added + cmsResult.added + placesResult.added + webResult.added;
          const totalSkipped = edgarResult.skipped + cmsResult.skipped + placesResult.skipped + webResult.skipped;

          const sourceBreakdown = {
            edgar_10k: edgarResult,
            cms_healthcare: cmsResult,
            google_places: placesResult,
            web_intelligence: webResult,
          };

          const finalStatus = errorMessage ? "failed" : "completed";
          console.log(`[agent] Finalizing as ${finalStatus}: found=${totalFound} added=${totalAdded} skipped=${totalSkipped}`);

          await supabase
            .from("agent_runs")
            .update({
              status: finalStatus,
              prospects_found: totalFound,
              prospects_added: totalAdded,
              prospects_skipped_dedup: totalSkipped,
              source_breakdown: sourceBreakdown,
              completed_at: new Date().toISOString(),
              error_message: errorMessage,
            })
            .eq("id", runId);

          for (const [agentName, res] of Object.entries(sourceBreakdown)) {
            if (res.found > 0 || res.added > 0) {
              const { data: reg } = await supabase
                .from("agent_registry")
                .select("run_count,total_found,total_inserted")
                .eq("agent_name", agentName)
                .maybeSingle();

              if (reg) {
                await supabase
                  .from("agent_registry")
                  .update({
                    run_count: (reg.run_count as number) + 1,
                    total_found: (reg.total_found as number) + res.found,
                    total_inserted: (reg.total_inserted as number) + res.added,
                    last_run_at: new Date().toISOString(),
                  })
                  .eq("agent_name", agentName);
              }
            }
          }
        });
      }
    }
  }
);
