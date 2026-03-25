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
import { sourceCmsHealthcare } from "@/lib/intel/source-cms-healthcare";

// ── Types ────────────────────────────────────────────────────────────────────

type SourceResult = {
  found: number;
  added: number;
  skipped: number;
  debug?: string[];
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
  account_type?: string;
  vertical?: string;
  contact_first_name?: string;
  contact_last_name?: string;
  contact_title?: string;
  contact_email?: string;
};

// ── Shared insert cap ────────────────────────────────────────────────────────

const MAX_INSERTS_PER_RUN = 500;
let insertCount = 0;

function isCapReached(): boolean {
  return insertCount >= MAX_INSERTS_PER_RUN;
}

async function insertIntelProspect(
  supabase: ReturnType<typeof createAdminClient>,
  prospect: Record<string, unknown>
): Promise<"added" | "skipped" | "error"> {
  if (isCapReached()) return "skipped";
  const { error } = await supabase.from("intel_prospects").insert(prospect);
  if (!error) {
    insertCount++;
    return "added";
  }
  if (error.code === "23505" || error.message?.includes("unique")) return "skipped";
  console.error("[prospect-discovery] insert error:", error.message);
  return "error";
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
    log.push(
      "FATAL: GOOGLE_PLACES_API_KEY not set — Google Places source disabled. Add this key to Vercel environment variables."
    );
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

  log.push(
    `Processing ${markets.length} markets x ${PLACES_QUERY_TEMPLATES.length} queries`
  );

  for (const { city, state } of markets) {
    if (isCapReached()) {
      log.push(`Insert cap reached (${insertCount}/${MAX_INSERTS_PER_RUN}), stopping`);
      break;
    }

    for (const template of PLACES_QUERY_TEMPLATES) {
      if (isCapReached()) break;

      const query = `${template} ${city} ${state}`;
      try {
        await delay(100);

        const resp = await fetch(
          `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`
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

          const addr = parseAddress(place.formatted_address ?? "");
          const hasStreetNumber = /^\d/.test(addr.address_line1 ?? "");

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

// ── Web Intelligence Source ──────────────────────────────────────────────────

async function sourceWebIntelligence(
  supabase: ReturnType<typeof createAdminClient>,
  anthropic: Anthropic,
  agentRunId: string
): Promise<SourceResult> {
  const result: SourceResult = { found: 0, added: 0, skipped: 0 };
  const log: string[] = [];

  const searches = [
    "largest commercial property management companies southeast United States",
    "top commercial REIT property portfolios Tennessee",
    "industrial warehouse property owners Memphis Nashville",
    "commercial building owners Atlanta Charlotte",
    "retail strip center property managers Texas",
  ];

  log.push(`Running ${searches.length} web searches`);

  for (const query of searches) {
    if (isCapReached()) {
      log.push(`Insert cap reached, stopping`);
      break;
    }
    try {
      log.push(`Searching: "${query}"`);

      const claudeResult = await callClaude(
        anthropic,
        "You are a commercial real estate researcher. Search the web for the given query and extract business information. Return ONLY a valid JSON array of objects with fields: company_name, address_line1, city, state, postal_code, website, phone, contact_name, contact_title, contact_email, account_type, vertical. Return [] if nothing found.",
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
      log.push(`"${query}": ${prospects.length} results`);

      for (const p of prospects) {
        const companyName = String(p.company_name ?? "");
        if (!companyName) continue;

        const domain = normalizeDomain(String(p.website ?? ""));
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
          contact_last_name:
            nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined,
          contact_title: String(p.contact_title ?? ""),
          contact_email: String(p.contact_email ?? ""),
          account_type: String(p.account_type ?? ""),
          vertical: String(p.vertical ?? ""),
        };

        const { score, breakdown } = scoreWithSource(
          "web_intelligence",
          prospect as unknown as Parameters<typeof scoreWithSource>[1]
        );
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
      log.push(`Error for "${query}": ${err instanceof Error ? err.message : err}`);
    }
  }

  log.push(`Done: found=${result.found} added=${result.added} skipped=${result.skipped}`);
  return { ...result, debug: log };
}

// ── Inngest Function ─────────────────────────────────────────────────────────

export const prospectDiscoveryAgent = inngest.createFunction(
  {
    id: "prospect-discovery-agent",
    retries: 1,
    triggers: [
      { event: "app/prospect-discovery.run" },
      { cron: "0 3 * * 1" }, // Weekly, Mondays at 3am UTC
    ],
  },
  async ({ step }) => {
    const supabase = createAdminClient();
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    insertCount = 0;

    let runId: string | null = null;
    let errorMessage: string | null = null;
    let placesResult: SourceResult = { found: 0, added: 0, skipped: 0 };
    let cmsResult: SourceResult = { found: 0, added: 0, skipped: 0 };
    let webResult: SourceResult = { found: 0, added: 0, skipped: 0 };

    try {
      runId = await step.run("setup", async () => {
        const { data: firstOrg } = await supabase
          .from("orgs")
          .select("id")
          .limit(1)
          .single();

        const { data: run, error: runErr } = await supabase
          .from("agent_runs")
          .insert({
            org_id: firstOrg?.id,
            run_type: "prospect_discovery",
            status: "running",
            started_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (runErr || !run)
          throw new Error("Failed to create agent_runs record");
        return run.id as string;
      });

      // ── Step: Google Places ─────────────────────────────────────────
      const pr = await step.run("source-google-places", async () => {
        return sourceGooglePlaces(supabase, runId!);
      });
      placesResult = pr;

      // ── Step: CMS Healthcare ────────────────────────────────────────
      const cr = await step.run("source-cms-healthcare", async () => {
        return sourceCmsHealthcare(
          supabase,
          runId!,
          insertIntelProspect,
          isCapReached
        );
      });
      cmsResult = cr;

      // ── Step: Web Intelligence ──────────────────────────────────────
      const wr = await step.run("source-web-intelligence", async () => {
        return sourceWebIntelligence(supabase, anthropic, runId!);
      });
      webResult = wr;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      if (runId) {
        await step.run("finalize", async () => {
          const totalFound =
            placesResult.found + cmsResult.found + webResult.found;
          const totalAdded =
            placesResult.added + cmsResult.added + webResult.added;
          const totalSkipped =
            placesResult.skipped + cmsResult.skipped + webResult.skipped;

          const sourceBreakdown = {
            google_places: placesResult,
            cms_healthcare: cmsResult,
            web_intelligence: webResult,
          };

          await supabase
            .from("agent_runs")
            .update({
              status: errorMessage ? "failed" : "completed",
              prospects_found: totalFound,
              prospects_added: totalAdded,
              prospects_skipped_dedup: totalSkipped,
              source_breakdown: sourceBreakdown,
              completed_at: new Date().toISOString(),
              error_message: errorMessage,
            })
            .eq("id", runId);

          // Trigger distributor after successful prospect discovery
          if (!errorMessage) {
            await inngest.send({ name: "app/intel-distributor.run", data: {} });
          }
        });
      }
    }
  }
);
