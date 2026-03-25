import { inngest } from "../client";
import { createAdminClient } from "@/lib/supabase/admin";
import Anthropic from "@anthropic-ai/sdk";
import { scoreWithSource } from "@/lib/intel/confidence";
import {
  safeParseJsonArray,
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

const MAX_INSERTS_PER_RUN = 500;
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

      const extraction = await extractItem2Properties(documentUrl, reit.name);
      const { portfolio, addresses } = extraction;

      log.push(
        `${reit.name}: ${portfolio.filing_type}, ` +
        `${portfolio.markets.length} markets, ${portfolio.total_properties ?? "?"} total props, ` +
        `${portfolio.decision_makers.length} contacts, ${addresses.length} addresses`
      );

      // ── Store portfolio intelligence on intel_entities ────────────
      // Look up the intel_entities record for this CIK
      const { data: entityRow } = await supabase
        .from("intel_entities")
        .select("id")
        .eq("cik", reit.cik)
        .maybeSingle();

      const entityId = entityRow?.id as string | null;

      if (entityId && !dryRun) {
        await supabase
          .from("intel_entities")
          .update({ portfolio_summary: portfolio })
          .eq("id", entityId);
        log.push(`Updated intel_entities.portfolio_summary for ${reit.name}`);
      } else if (dryRun) {
        log.push(`[DRY RUN] Would update intel_entities portfolio for ${reit.name}`);
      }

      // ── Store decision_makers in intel_contacts ──────────────────
      for (const dm of portfolio.decision_makers) {
        if (!dm.name) continue;
        const nameParts = dm.name.split(/\s+/);

        if (!dryRun && entityId) {
          await supabase.from("intel_contacts").insert({
            intel_entity_id: entityId,
            first_name: nameParts[0] || null,
            last_name: nameParts.length > 1 ? nameParts.slice(1).join(" ") : null,
            full_name: dm.name,
            title: dm.title || null,
            contact_type: dm.contact_type || "executive",
            source_detail: "edgar_10k",
            agent_metadata: { cik: reit.cik, ticker: reit.ticker },
          });
        } else if (dryRun) {
          log.push(`[DRY RUN] Would insert contact: ${dm.name} (${dm.title})`);
        }
      }
      if (portfolio.decision_makers.length > 0) {
        log.push(`Inserted ${portfolio.decision_makers.length} contacts for ${reit.name}`);
      }

      // ── Type A only: insert addresses into intel_prospects ───────
      if (portfolio.filing_type === "type_a" && addresses.length > 0) {
        for (const addr of addresses) {
          if (isCapReached()) break;

          let score = 20;
          if (addr.address) score += 15;
          if (addr.state) score += 10;
          if (addr.property_type !== "unknown") score += 10;
          if (addr.sq_footage) score += 10;
          score += Math.min(30, Math.max(0, addr.confidence_boost));
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
              address_line1: addr.address || null,
              city: addr.city || null,
              state: addr.state || null,
              postal_code: addr.zip || null,
              building_type: addr.property_type || null,
              building_sq_footage: addr.sq_footage || null,
              account_type: "owner",
              vertical: "commercial_real_estate",
              owner_name_legal: reit.name,
              entity_id: entityId,
              confidence_score: score,
              source: "agent",
              source_detail: "edgar_10k_address",
              agent_run_id: agentRunId,
              agent_metadata: {
                cik: reit.cik,
                ticker: reit.ticker,
                tenant: addr.tenant,
              },
            });

            if (status === "added") result.added++;
            else if (status === "skipped") result.skipped++;
          } else {
            log.push(
              `[DRY RUN] Would insert address: ${addr.address}, ${addr.city}, ${addr.state} (score=${score})`
            );
            result.added++;
          }
        }
      } else if (portfolio.filing_type !== "type_a") {
        log.push(`${reit.name}: type_b/c — portfolio stored on entity, no addresses for intel_prospects`);
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

// ── Google Places Source (territory-driven) ──────────────────────────────────

const DEFAULT_METROS: { city: string; state: string }[] = [
  { city: "Memphis", state: "TN" },
  { city: "Nashville", state: "TN" },
  { city: "Dallas", state: "TX" },
  { city: "Houston", state: "TX" },
  { city: "Atlanta", state: "GA" },
  { city: "Charlotte", state: "NC" },
  { city: "Tampa", state: "FL" },
];

const PLACES_QUERY_TEMPLATES = [
  "commercial property management",
  "industrial park",
  "commercial real estate",
];

async function sourceGooglePlaces(
  supabase: ReturnType<typeof createAdminClient>,
  agentRunId: string
): Promise<SourceResult> {
  const result: SourceResult = { found: 0, added: 0, skipped: 0 };
  const log: string[] = [];
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    log.push("FATAL: GOOGLE_PLACES_API_KEY not set — Google Places source disabled. Add this key to Vercel environment variables.");
    console.log("[places] " + log[0]);
    return { found: 0, added: 0, skipped: 0, debug: log };
  }

  // Load territory regions across all orgs
  const { data: regions } = await supabase
    .from("territory_regions")
    .select("region_value,region_type,state")
    .in("region_type", ["city", "zip", "county"])
    .limit(50);

  let markets: { city: string; state: string }[] = [];

  if (regions && regions.length > 0) {
    // Deduplicate city+state pairs
    const seen = new Set<string>();
    for (const r of regions) {
      const city = (r.region_value as string).trim();
      const state = (r.state as string).trim().toUpperCase();
      const key = `${city.toLowerCase()}|${state}`;
      if (r.region_type === "city" && !seen.has(key)) {
        seen.add(key);
        markets.push({ city, state });
      }
    }
    log.push(`Loaded ${markets.length} cities from territory_regions`);
  }

  if (markets.length === 0) {
    markets = DEFAULT_METROS;
    log.push(`No territory regions found, using ${markets.length} default metros`);
  }

  log.push(`Processing ${markets.length} markets x ${PLACES_QUERY_TEMPLATES.length} queries (cap: ${MAX_INSERTS_PER_RUN})`);

  for (const { city, state } of markets) {
    if (isCapReached()) {
      log.push(`Global insert cap reached (${globalInsertCount}/${MAX_INSERTS_PER_RUN}), stopping`);
      break;
    }

    for (const template of PLACES_QUERY_TEMPLATES) {
      if (isCapReached()) break;

      const query = `${template} ${city} ${state}`;
      try {
        await delay(100);

        const resp = await fetch(
          `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`,
        );

        if (!resp.ok) {
          log.push(`API error ${resp.status} for "${query}"`);
          continue;
        }

        const data = (await resp.json()) as {
          results?: {
            name?: string;
            formatted_address?: string;
            place_id?: string;
            types?: string[];
            rating?: number;
            business_status?: string;
          }[];
          status?: string;
        };

        if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
          log.push(`API status ${data.status} for "${query}"`);
          continue;
        }

        const places = data.results ?? [];
        log.push(`"${query}": ${places.length} results`);

        for (const place of places) {
          const companyName = place.name;
          if (!companyName) continue;

          // Parse formatted_address: "123 Main St, Memphis, TN 38103, USA"
          const addr = parseAddress(place.formatted_address ?? "");
          const hasStreetNumber = /^\d/.test(addr.address_line1 ?? "");

          // Score
          let score = 25;
          if (hasStreetNumber) score += 15;
          if (place.types?.includes("establishment")) score += 10;
          if (place.business_status === "OPERATIONAL") score += 10;
          score = Math.min(100, score);

          result.found++;

          if (score < 35) {
            result.skipped++;
            continue;
          }

          const status = await insertIntelProspect(supabase, {
            company_name: companyName,
            domain_normalized: null,
            address_line1: addr.address_line1 || null,
            city: addr.city || city,
            state: addr.state || state,
            postal_code: addr.postal_code || null,
            account_type: "commercial_property_management",
            confidence_score: score,
            source: "agent",
            source_detail: "google_places",
            agent_run_id: agentRunId,
            agent_metadata: {
              place_id: place.place_id,
              types: place.types,
              rating: place.rating,
              business_status: place.business_status,
              query,
            },
          });

          if (status === "added") result.added++;
          else if (status === "skipped") result.skipped++;
        }
      } catch (err) {
        log.push(`Error for "${query}": ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  log.push(`Done: found=${result.found} added=${result.added} skipped=${result.skipped}`);
  return { ...result, debug: log };
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
