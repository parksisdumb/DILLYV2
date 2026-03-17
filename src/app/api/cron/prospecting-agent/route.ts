import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import Anthropic from "@anthropic-ai/sdk";

// ── Types ────────────────────────────────────────────────────────────────────

type IcpCriteria = {
  criteria_type: string;
  criteria_value: string;
};

type IcpProfile = {
  id: string;
  org_id: string;
  name: string;
  territory_id: string | null;
  criteria: IcpCriteria[];
};

type TerritoryRegion = {
  region_type: string;
  region_value: string;
  state: string;
};

type RawProspect = {
  company_name: string;
  website?: string;
  email?: string;
  phone?: string;
  contact_first_name?: string;
  contact_last_name?: string;
  contact_title?: string;
  address_line1?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  account_type?: string;
  vertical?: string;
  agent_metadata?: Record<string, unknown>;
};

type SourceResult = {
  source_detail: string;
  prospects: RawProspect[];
};

type SourceFn = (
  anthropic: Anthropic,
  regions: TerritoryRegion[],
  icp: IcpProfile
) => Promise<SourceResult>;

// ── ICP Scoring ──────────────────────────────────────────────────────────────

function scoreProspect(
  prospect: RawProspect,
  criteria: IcpCriteria[]
): number {
  let score = 0;

  const criteriaByType = new Map<string, string[]>();
  for (const c of criteria) {
    const existing = criteriaByType.get(c.criteria_type) ?? [];
    existing.push(c.criteria_value.toLowerCase());
    criteriaByType.set(c.criteria_type, existing);
  }

  // account_type match: +30
  const accountTypes = criteriaByType.get("account_type");
  if (
    accountTypes &&
    prospect.account_type &&
    accountTypes.includes(prospect.account_type.toLowerCase())
  ) {
    score += 30;
  }

  // vertical match: +25
  const verticals = criteriaByType.get("vertical");
  if (
    verticals &&
    prospect.vertical &&
    verticals.includes(prospect.vertical.toLowerCase())
  ) {
    score += 25;
  }

  // building_type match: +15
  const buildingTypes = criteriaByType.get("building_type");
  if (buildingTypes && prospect.agent_metadata) {
    const bType = String(
      prospect.agent_metadata.building_type ?? ""
    ).toLowerCase();
    if (bType && buildingTypes.includes(bType)) {
      score += 15;
    }
  }

  // decision_role found: +10
  const decisionRoles = criteriaByType.get("decision_role");
  if (decisionRoles && prospect.contact_title) {
    const title = prospect.contact_title.toLowerCase();
    if (decisionRoles.some((r) => title.includes(r.replace(/_/g, " ")))) {
      score += 10;
    }
  }

  // property_size in range: +20 (if metadata has sq_footage)
  if (prospect.agent_metadata?.sq_footage) {
    const sqft = Number(prospect.agent_metadata.sq_footage);
    const minSize = criteriaByType.get("property_size_min");
    const maxSize = criteriaByType.get("property_size_max");
    const min = minSize?.[0] ? Number(minSize[0]) : 0;
    const max = maxSize?.[0] ? Number(maxSize[0]) : Infinity;
    if (sqft >= min && sqft <= max) {
      score += 20;
    }
  }

  return score;
}

// ── Claude helper with retry ─────────────────────────────────────────────────

async function callClaude(
  anthropic: Anthropic,
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 4096
): Promise<string> {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: maxTokens,
        system: systemPrompt,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
        messages: [{ role: "user", content: userPrompt }],
      });

      // Extract text from response
      const textBlocks = response.content.filter(
        (b) => b.type === "text"
      );
      return textBlocks.map((b) => (b as { type: "text"; text: string }).text).join("\n");
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      if (error.status === 529 && attempt < maxRetries - 1) {
        // Overloaded — exponential backoff
        await new Promise((r) =>
          setTimeout(r, 2000 * Math.pow(2, attempt))
        );
        continue;
      }
      throw err;
    }
  }
  return "";
}

// ── Source 1: SEC EDGAR REIT filings ─────────────────────────────────────────

const sourceSecEdgar: SourceFn = async (anthropic, regions, icp) => {
  const prospects: RawProspect[] = [];
  const states = [...new Set(regions.map((r) => r.state))];
  const cities = regions
    .filter((r) => r.region_type === "city")
    .map((r) => r.region_value);

  try {
    const searchTerms = states.slice(0, 2).join("+");
    const edgarUrl = `https://efts.sec.gov/LATEST/search-index?q=%22commercial+property%22+${encodeURIComponent(searchTerms)}&forms=10-K&dateRange=custom&startdt=${getDateMonthsAgo(6)}&enddt=${getTodayDate()}`;

    const edgarRes = await fetch(edgarUrl, {
      headers: { "User-Agent": "Dilly-BD-OS admin@dilly.dev" },
    });

    if (!edgarRes.ok) {
      console.warn(`SEC EDGAR search returned ${edgarRes.status}`);
      return { source_detail: "sec_edgar", prospects: [] };
    }

    const edgarData = await edgarRes.json();
    const filings = (edgarData.hits?.hits ?? []).slice(0, 5);

    if (filings.length === 0) {
      return { source_detail: "sec_edgar", prospects: [] };
    }

    const filingNames = filings
      .map(
        (f: { _source?: { entity_name?: string; file_date?: string } }) =>
          `${f._source?.entity_name ?? "Unknown"} (filed ${f._source?.file_date ?? "unknown"})`
      )
      .join("\n");

    const targetCities = cities.length > 0 ? cities.join(", ") : states.join(", ");

    const result = await callClaude(
      anthropic,
      "You are a commercial real estate research assistant. Extract property information from REIT filings and public data.",
      `I found these REIT 10-K filings from SEC EDGAR:\n${filingNames}\n\nSearch the web for property portfolios owned by these REITs in or near: ${targetCities}\n\nFor each commercial property you find, return a JSON array of objects with these fields:\n- company_name (the REIT or property owner)\n- address_line1\n- city\n- state\n- postal_code\n- account_type (one of: owner, commercial_property_management, asset_management)\n- vertical (one of: commercial_office, retail, industrial_warehouse, healthcare, multifamily, mixed_use)\n- contact_first_name (if found)\n- contact_last_name (if found)\n- contact_title (if found)\n- website\n\nReturn ONLY valid JSON array, no other text. If you find nothing, return [].`
    );

    const parsed = safeParseJsonArray(result);
    for (const p of parsed) {
      prospects.push({
        company_name: String(p.company_name ?? "Unknown Company"),
        website: p.website as string | undefined,
        email: p.email as string | undefined,
        phone: p.phone as string | undefined,
        contact_first_name: p.contact_first_name as string | undefined,
        contact_last_name: p.contact_last_name as string | undefined,
        contact_title: p.contact_title as string | undefined,
        address_line1: p.address_line1 as string | undefined,
        city: p.city as string | undefined,
        state: p.state as string | undefined,
        postal_code: p.postal_code as string | undefined,
        account_type: p.account_type as string | undefined,
        vertical: p.vertical as string | undefined,
        agent_metadata: { source: "sec_edgar", raw: p },
      });
    }
  } catch (err) {
    console.error("SEC EDGAR source error:", err);
  }

  return { source_detail: "sec_edgar", prospects };
};

// ── Source 2: OpenStreetMap Overpass API ──────────────────────────────────────

const sourceOpenStreetMap: SourceFn = async (anthropic, regions, icp) => {
  const prospects: RawProspect[] = [];
  const zipCodes = regions
    .filter((r) => r.region_type === "zip")
    .map((r) => r.region_value)
    .slice(0, 5); // Limit to avoid overloading Overpass

  for (const zip of zipCodes) {
    try {
      // Query Overpass for commercial buildings in this zip
      const query = `[out:json][timeout:25];
area[postal_code="${zip}"]["boundary"="postal_code"]->.searchArea;
(
  way["building"="commercial"](area.searchArea);
  way["building"="retail"](area.searchArea);
  way["building"="industrial"](area.searchArea);
  way["building"="office"](area.searchArea);
  way["building"="warehouse"](area.searchArea);
);
out center body 20;`;

      const overpassRes = await fetch(
        "https://overpass-api.de/api/interpreter",
        {
          method: "POST",
          body: `data=${encodeURIComponent(query)}`,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
      );

      if (!overpassRes.ok) {
        console.warn(`Overpass API returned ${overpassRes.status} for zip ${zip}`);
        continue;
      }

      const overpassData = await overpassRes.json();
      const elements = (overpassData.elements ?? []).slice(0, 15);

      if (elements.length === 0) continue;

      // Build summaries for Claude to classify
      const buildingSummaries = elements
        .map(
          (e: {
            tags?: Record<string, string>;
            center?: { lat: number; lon: number };
          }) => {
            const tags = e.tags ?? {};
            return `- ${tags.name ?? "Unnamed"} | type: ${tags.building} | addr: ${tags["addr:street"] ?? "unknown"} ${tags["addr:housenumber"] ?? ""} | city: ${tags["addr:city"] ?? "unknown"}`;
          }
        )
        .join("\n");

      const region = regions.find((r) => r.region_value === zip);
      const state = region?.state ?? "";

      const result = await callClaude(
        anthropic,
        "You are a commercial property research assistant. Classify buildings by type and extract details.",
        `These commercial buildings were found in zip code ${zip}, ${state} from OpenStreetMap:\n${buildingSummaries}\n\nFor each building, return a JSON array of objects:\n- company_name (building name or "Commercial Property at [address]")\n- address_line1\n- city\n- state (use "${state}")\n- postal_code (use "${zip}")\n- account_type: "owner"\n- vertical (classify as: commercial_office, retail, industrial_warehouse, healthcare, or mixed_use)\n- building_type (the OSM building tag value)\n\nReturn ONLY valid JSON array. If nothing useful, return [].`
      );

      const parsed = safeParseJsonArray(result);
      for (const p of parsed) {
        prospects.push({
          company_name: String(p.company_name ?? "Unknown Building"),
          address_line1: p.address_line1 as string | undefined,
          city: p.city as string | undefined,
          state: p.state as string | undefined,
          postal_code: p.postal_code as string | undefined,
          account_type: p.account_type as string | undefined,
          vertical: p.vertical as string | undefined,
          agent_metadata: {
            source: "openstreetmap",
            building_type: p.building_type,
            raw: p,
          },
        });
      }
    } catch (err) {
      console.error(`Overpass error for zip ${zip}:`, err);
    }
  }

  return { source_detail: "openstreetmap", prospects };
};

// ── Source 3: Web Intelligence via Claude web_search ─────────────────────────

const sourceWebIntelligence: SourceFn = async (anthropic, regions, icp) => {
  const prospects: RawProspect[] = [];
  const cities = regions
    .filter((r) => r.region_type === "city")
    .map((r) => ({ city: r.region_value, state: r.state }));

  // Also derive cities from zip codes if no city regions
  if (cities.length === 0) {
    const states = [...new Set(regions.map((r) => r.state))];
    for (const s of states.slice(0, 2)) {
      cities.push({ city: s, state: s }); // state-level fallback
    }
  }

  // Get ICP criteria for search context
  const accountTypes = icp.criteria
    .filter((c) => c.criteria_type === "account_type")
    .map((c) => c.criteria_value);
  const verticals = icp.criteria
    .filter((c) => c.criteria_type === "vertical")
    .map((c) => c.criteria_value);

  for (const { city, state } of cities.slice(0, 3)) {
    try {
      const searchQueries = [
        `${city} ${state} commercial property management companies`,
        `${city} ${state} REIT properties commercial`,
        `${city} ${state} industrial warehouse property owner`,
        `${city} ${state} retail strip center property manager`,
      ];

      const verticalContext = verticals.length > 0
        ? `Target verticals: ${verticals.join(", ")}`
        : "Any commercial property vertical";
      const accountContext = accountTypes.length > 0
        ? `Target account types: ${accountTypes.join(", ")}`
        : "Any commercial property account type";

      const result = await callClaude(
        anthropic,
        "You are a B2B commercial property lead generation specialist. You find companies and contacts for commercial roofing business development.",
        `Search the web for commercial property companies in ${city}, ${state}.\n\nRun these searches:\n${searchQueries.map((q) => `- "${q}"`).join("\n")}\n\n${verticalContext}\n${accountContext}\n\nFor each company you find, return a JSON array of objects:\n- company_name\n- website (if found)\n- address_line1 (if found)\n- city: "${city}"\n- state: "${state}"\n- postal_code (if found)\n- account_type (one of: owner, commercial_property_management, facilities_management, asset_management, general_contractor, developer, broker)\n- vertical (one of: commercial_office, retail, industrial_warehouse, healthcare, education, hospitality, multifamily, mixed_use)\n- contact_first_name (if found)\n- contact_last_name (if found)\n- contact_title (if found)\n- email (if found)\n- phone (if found)\n\nReturn ONLY valid JSON array. Aim for 5-15 high-quality results. If nothing found, return [].`
      );

      const parsed = safeParseJsonArray(result);
      for (const p of parsed) {
        prospects.push({
          company_name: String(p.company_name ?? "Unknown Company"),
          website: p.website as string | undefined,
          email: p.email as string | undefined,
          phone: p.phone as string | undefined,
          contact_first_name: p.contact_first_name as string | undefined,
          contact_last_name: p.contact_last_name as string | undefined,
          contact_title: p.contact_title as string | undefined,
          address_line1: p.address_line1 as string | undefined,
          city: p.city as string | undefined,
          state: p.state as string | undefined,
          postal_code: p.postal_code as string | undefined,
          account_type: p.account_type as string | undefined,
          vertical: p.vertical as string | undefined,
          agent_metadata: {
            source: "web_intelligence",
            city,
            state,
            raw: p,
          },
        });
      }
    } catch (err) {
      console.error(`Web intelligence error for ${city}, ${state}:`, err);
    }
  }

  return { source_detail: "web_intelligence", prospects };
};

// ── Source registry — add new sources here ────────────────────────────────────

const SOURCES: SourceFn[] = [
  sourceSecEdgar,
  sourceOpenStreetMap,
  sourceWebIntelligence,
  // TODO: Add BatchData source here when API key is available
  // sourceBatchData,
  // TODO: Add PropTracer source here when API key is available
  // sourcePropTracer,
];

// ── Utilities ────────────────────────────────────────────────────────────────

function safeParseJsonArray(text: string): Record<string, unknown>[] {
  try {
    // Extract JSON array from response (may contain markdown fences)
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeDomain(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = url.startsWith("http") ? url : `https://${url}`;
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.replace(/^(https?:\/\/)?(www\.)?/i, "").split("/")[0].toLowerCase() || null;
  }
}

function getDateMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().split("T")[0];
}

function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

// ── Main agent logic ─────────────────────────────────────────────────────────

async function runAgentForOrg(
  supabase: ReturnType<typeof createAdminClient>,
  anthropic: Anthropic,
  orgId: string
) {
  // Create agent run record
  const { data: agentRun, error: runErr } = await supabase
    .from("agent_runs")
    .insert({ org_id: orgId, run_type: "prospecting", status: "running" })
    .select("id")
    .single();

  if (runErr || !agentRun) {
    console.error(`Failed to create agent run for org ${orgId}:`, runErr);
    return;
  }

  const runId = agentRun.id;

  try {
    // Fetch active ICP profiles for this org
    const { data: icpProfiles } = await supabase
      .from("icp_profiles")
      .select("id,org_id,name,territory_id")
      .eq("org_id", orgId)
      .eq("active", true);

    if (!icpProfiles || icpProfiles.length === 0) {
      await supabase
        .from("agent_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          error_message: "No active ICP profiles found",
        })
        .eq("id", runId);
      return;
    }

    let totalFound = 0;
    let totalAdded = 0;
    let totalSkipped = 0;
    const sourceBreakdown: Record<string, { found: number; added: number; skipped: number }> = {};

    for (const profile of icpProfiles) {
      // Fetch criteria for this ICP
      const { data: criteria } = await supabase
        .from("icp_criteria")
        .select("criteria_type,criteria_value")
        .eq("icp_profile_id", profile.id);

      const icpWithCriteria: IcpProfile = {
        ...profile,
        criteria: criteria ?? [],
      };

      // Fetch territory regions
      let regions: TerritoryRegion[] = [];
      if (profile.territory_id) {
        const { data: regionData } = await supabase
          .from("territory_regions")
          .select("region_type,region_value,state")
          .eq("territory_id", profile.territory_id);
        regions = regionData ?? [];
      }

      if (regions.length === 0) {
        console.log(
          `Skipping ICP "${profile.name}" — no territory regions`
        );
        continue;
      }

      // Run each source
      for (const sourceFn of SOURCES) {
        try {
          const result = await sourceFn(anthropic, regions, icpWithCriteria);
          const { source_detail, prospects } = result;

          if (!sourceBreakdown[source_detail]) {
            sourceBreakdown[source_detail] = { found: 0, added: 0, skipped: 0 };
          }

          sourceBreakdown[source_detail].found += prospects.length;
          totalFound += prospects.length;

          // Score and insert each prospect
          for (const raw of prospects) {
            const confidence = scoreProspect(raw, icpWithCriteria.criteria);
            if (confidence < 40) continue;

            const domainNormalized = normalizeDomain(raw.website);

            const { error: insertErr } = await supabase
              .from("prospects")
              .insert({
                org_id: orgId,
                territory_id: profile.territory_id,
                icp_profile_id: profile.id,
                company_name: raw.company_name || "Unknown Company",
                website: raw.website || null,
                domain_normalized: domainNormalized,
                email: raw.email || null,
                phone: raw.phone || null,
                contact_first_name: raw.contact_first_name || null,
                contact_last_name: raw.contact_last_name || null,
                contact_title: raw.contact_title || null,
                address_line1: raw.address_line1 || null,
                city: raw.city || null,
                state: raw.state || null,
                postal_code: raw.postal_code || null,
                account_type: raw.account_type || null,
                vertical: raw.vertical || null,
                source: "agent",
                source_detail,
                confidence_score: confidence,
                agent_metadata: raw.agent_metadata || null,
              });

            if (insertErr) {
              // Likely dedup violation
              if (
                insertErr.code === "23505" ||
                insertErr.message?.includes("duplicate") ||
                insertErr.message?.includes("unique")
              ) {
                totalSkipped++;
                sourceBreakdown[source_detail].skipped++;
              } else {
                console.error("Prospect insert error:", insertErr);
              }
            } else {
              totalAdded++;
              sourceBreakdown[source_detail].added++;
            }
          }
        } catch (sourceErr) {
          console.error(`Source error:`, sourceErr);
        }
      }
    }

    // Mark run as completed
    await supabase
      .from("agent_runs")
      .update({
        status: "completed",
        prospects_found: totalFound,
        prospects_added: totalAdded,
        prospects_skipped_dedup: totalSkipped,
        source_breakdown: sourceBreakdown,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
  } catch (err) {
    console.error(`Agent run ${runId} failed:`, err);
    await supabase
      .from("agent_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: err instanceof Error ? err.message : String(err),
      })
      .eq("id", runId);
  }
}

// ── Route handler ────────────────────────────────────────────────────────────

export const maxDuration = 300; // 5 min max for Vercel Pro

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json(
      { error: "Missing ANTHROPIC_API_KEY" },
      { status: 500 }
    );
  }

  const supabase = createAdminClient();
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  // Fetch all orgs that have active ICP profiles
  const { data: activeOrgs } = await supabase
    .from("icp_profiles")
    .select("org_id")
    .eq("active", true);

  const orgIds = [...new Set((activeOrgs ?? []).map((o) => o.org_id as string))];

  if (orgIds.length === 0) {
    return NextResponse.json({ ok: true, message: "No active ICP profiles found" });
  }

  // Run agent for each org sequentially to manage API rate limits
  const results: { org_id: string; status: string }[] = [];
  for (const orgId of orgIds) {
    try {
      await runAgentForOrg(supabase, anthropic, orgId);
      results.push({ org_id: orgId, status: "completed" });
    } catch (err) {
      console.error(`Agent failed for org ${orgId}:`, err);
      results.push({ org_id: orgId, status: "failed" });
    }
  }

  return NextResponse.json({ ok: true, orgs_processed: results.length, results });
}
