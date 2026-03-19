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

// ── Timeout tracking ─────────────────────────────────────────────────────────

const RUN_START = Date.now();
const MAX_RUN_MS = 4 * 60 * 1000; // 4 minutes — stop before Vercel kills us

function isTimeUp(): boolean {
  return Date.now() - RUN_START > MAX_RUN_MS;
}

function timeRemainingMs(): number {
  return Math.max(0, MAX_RUN_MS - (Date.now() - RUN_START));
}

// ── ICP Scoring ──────────────────────────────────────────────────────────────

const MIN_CONFIDENCE = 25; // Low threshold for initial calibration

function scoreProspect(
  prospect: RawProspect,
  criteria: IcpCriteria[]
): { score: number; breakdown: string[] } {
  let score = 0;
  const breakdown: string[] = [];

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
    breakdown.push(`+30 account_type "${prospect.account_type}"`);
  }

  // vertical match: +25
  const verticals = criteriaByType.get("vertical");
  if (
    verticals &&
    prospect.vertical &&
    verticals.includes(prospect.vertical.toLowerCase())
  ) {
    score += 25;
    breakdown.push(`+25 vertical "${prospect.vertical}"`);
  }

  // building_type match: +15
  const buildingTypes = criteriaByType.get("building_type");
  if (buildingTypes && prospect.agent_metadata) {
    const bType = String(
      prospect.agent_metadata.building_type ?? ""
    ).toLowerCase();
    if (bType && buildingTypes.includes(bType)) {
      score += 15;
      breakdown.push(`+15 building_type "${bType}"`);
    }
  }

  // decision_role found: +10
  const decisionRoles = criteriaByType.get("decision_role");
  if (decisionRoles && prospect.contact_title) {
    const title = prospect.contact_title.toLowerCase();
    if (decisionRoles.some((r) => title.includes(r.replace(/_/g, " ")))) {
      score += 10;
      breakdown.push(`+10 decision_role in title "${prospect.contact_title}"`);
    }
  }

  // property_size in range: +20
  if (prospect.agent_metadata?.sq_footage) {
    const sqft = Number(prospect.agent_metadata.sq_footage);
    const minSize = criteriaByType.get("property_size_min");
    const maxSize = criteriaByType.get("property_size_max");
    const min = minSize?.[0] ? Number(minSize[0]) : 0;
    const max = maxSize?.[0] ? Number(maxSize[0]) : Infinity;
    if (sqft >= min && sqft <= max) {
      score += 20;
      breakdown.push(`+20 property_size ${sqft} sqft in range`);
    }
  }

  // If no criteria matched but we have data, give base points
  if (score === 0 && criteria.length === 0) {
    // No ICP criteria defined — give base score if prospect has useful data
    if (prospect.company_name && prospect.company_name !== "Unknown Company") {
      score += 25;
      breakdown.push("+25 base (no ICP criteria defined, has company name)");
    }
  }

  return { score, breakdown };
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
        tools: [
          { type: "web_search_20250305" as const, name: "web_search", max_uses: 5 },
        ],
        messages: [{ role: "user", content: userPrompt }],
      });

      const textBlocks = response.content.filter(
        (b) => b.type === "text"
      );
      return textBlocks
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("\n");
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      console.error(
        `[agent] Claude API attempt ${attempt + 1}/${maxRetries} failed:`,
        error.status,
        error.message
      );
      if (error.status === 529 && attempt < maxRetries - 1) {
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

  console.log(`[agent][sec_edgar] Starting — states: ${states.join(", ")}, cities: ${cities.join(", ")}`);

  try {
    const edgarUrl = `https://efts.sec.gov/LATEST/search-index?q=%22commercial+property%22&dateRange=custom&startdt=2024-01-01&forms=10-K`;

    console.log(`[agent][sec_edgar] Fetching: ${edgarUrl}`);
    const edgarRes = await fetch(edgarUrl, {
      headers: { "User-Agent": "Dilly-BD-OS admin@dilly.dev" },
    });

    if (!edgarRes.ok) {
      console.warn(`[agent][sec_edgar] HTTP ${edgarRes.status} — skipping`);
      return { source_detail: "sec_edgar", prospects: [] };
    }

    const edgarData = await edgarRes.json();
    const filings = (edgarData.hits?.hits ?? []).slice(0, 5);
    console.log(`[agent][sec_edgar] Found ${filings.length} filings`);

    if (filings.length === 0) {
      return { source_detail: "sec_edgar", prospects: [] };
    }

    const filingNames = filings
      .map(
        (f: { _source?: { entity_name?: string; file_date?: string } }) =>
          `${f._source?.entity_name ?? "Unknown"} (filed ${f._source?.file_date ?? "unknown"})`
      )
      .join("\n");

    const targetCities =
      cities.length > 0 ? cities.join(", ") : states.join(", ");

    console.log(`[agent][sec_edgar] Calling Claude to extract properties near: ${targetCities}`);
    const result = await callClaude(
      anthropic,
      "You are a commercial real estate research assistant. Extract property information from REIT filings and public data.",
      `I found these REIT 10-K filings from SEC EDGAR:\n${filingNames}\n\nSearch the web for property portfolios owned by these REITs in or near: ${targetCities}\n\nFor each commercial property you find, return a JSON array of objects with these fields:\n- company_name (the REIT or property owner)\n- address_line1\n- city\n- state\n- postal_code\n- account_type (one of: owner, commercial_property_management, asset_management)\n- vertical (one of: commercial_office, retail, industrial_warehouse, healthcare, multifamily, mixed_use)\n- contact_first_name (if found)\n- contact_last_name (if found)\n- contact_title (if found)\n- website\n\nReturn ONLY valid JSON array, no other text. If you find nothing, return [].`
    );

    const parsed = safeParseJsonArray(result);
    console.log(`[agent][sec_edgar] Claude returned ${parsed.length} prospects`);

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
    console.error("[agent][sec_edgar] Error:", err);
  }

  console.log(`[agent][sec_edgar] Done — ${prospects.length} total prospects`);
  return { source_detail: "sec_edgar", prospects };
};

// ── Source 2: OpenStreetMap Overpass API ──────────────────────────────────────

async function getZipBoundingBox(
  zip: string,
  state: string
): Promise<{ south: number; west: number; north: number; east: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(zip)}&country=US&state=${encodeURIComponent(state)}&format=json&limit=1`;
    console.log(`[agent][osm] Geocoding zip ${zip}: ${url}`);
    const res = await fetch(url, {
      headers: { "User-Agent": "Dilly-BD-OS admin@dilly.dev" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data[0]?.boundingbox) return null;
    const [south, north, west, east] = data[0].boundingbox.map(Number);
    console.log(`[agent][osm] Zip ${zip} bbox: ${south},${west},${north},${east}`);
    return { south, west, north, east };
  } catch (err) {
    console.error(`[agent][osm] Geocoding failed for zip ${zip}:`, err);
    return null;
  }
}

const sourceOpenStreetMap: SourceFn = async (anthropic, regions, icp) => {
  const prospects: RawProspect[] = [];
  const zipRegions = regions
    .filter((r) => r.region_type === "zip")
    .slice(0, 5);

  // Also try city regions if no zips
  const cityRegions = regions
    .filter((r) => r.region_type === "city")
    .slice(0, 3);

  const regionsToQuery =
    zipRegions.length > 0 ? zipRegions : cityRegions;

  console.log(
    `[agent][osm] Starting — ${regionsToQuery.length} regions to query (${zipRegions.length} zips, ${cityRegions.length} cities)`
  );

  for (const region of regionsToQuery) {
    if (isTimeUp()) {
      console.log("[agent][osm] Time limit reached — stopping");
      break;
    }

    try {
      let query: string;

      if (region.region_type === "zip") {
        // Get bounding box via Nominatim
        const bbox = await getZipBoundingBox(
          region.region_value,
          region.state
        );
        if (!bbox) {
          console.warn(`[agent][osm] No bbox for zip ${region.region_value} — skipping`);
          continue;
        }
        query = `[out:json][timeout:25];
(
  way["building"="commercial"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["building"="retail"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["building"="industrial"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["building"="office"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["building"="warehouse"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
out center body 20;`;
      } else {
        // City query
        query = `[out:json][timeout:25];
area["name"="${region.region_value}"]["admin_level"]["boundary"="administrative"]->.searchArea;
(
  way["building"="commercial"](area.searchArea);
  way["building"="retail"](area.searchArea);
  way["building"="industrial"](area.searchArea);
  way["building"="office"](area.searchArea);
  way["building"="warehouse"](area.searchArea);
);
out center body 20;`;
      }

      console.log(
        `[agent][osm] Querying Overpass for ${region.region_type}=${region.region_value}`
      );
      const overpassRes = await fetch(
        "https://overpass-api.de/api/interpreter",
        {
          method: "POST",
          body: `data=${encodeURIComponent(query)}`,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
      );

      if (!overpassRes.ok) {
        console.warn(
          `[agent][osm] Overpass ${overpassRes.status} for ${region.region_value}`
        );
        continue;
      }

      const overpassData = await overpassRes.json();
      const elements = (overpassData.elements ?? []).slice(0, 15);
      console.log(
        `[agent][osm] Overpass returned ${overpassData.elements?.length ?? 0} elements (using first ${elements.length})`
      );

      if (elements.length === 0) continue;

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

      console.log(`[agent][osm] Calling Claude to classify ${elements.length} buildings`);
      const result = await callClaude(
        anthropic,
        "You are a commercial property research assistant. Classify buildings by type and extract details.",
        `These commercial buildings were found in ${region.region_value}, ${region.state} from OpenStreetMap:\n${buildingSummaries}\n\nFor each building, return a JSON array of objects:\n- company_name (building name or "Commercial Property at [address]")\n- address_line1\n- city\n- state (use "${region.state}")\n- postal_code\n- account_type: "owner"\n- vertical (classify as: commercial_office, retail, industrial_warehouse, healthcare, or mixed_use)\n- building_type (the OSM building tag value)\n\nReturn ONLY valid JSON array. If nothing useful, return [].`
      );

      const parsed = safeParseJsonArray(result);
      console.log(`[agent][osm] Claude returned ${parsed.length} classified buildings`);

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

      // Be polite to Nominatim/Overpass — 1s delay between queries
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.error(
        `[agent][osm] Error for ${region.region_value}:`,
        err
      );
    }
  }

  console.log(`[agent][osm] Done — ${prospects.length} total prospects`);
  return { source_detail: "openstreetmap", prospects };
};

// ── Source 3: Web Intelligence via Claude web_search ─────────────────────────

const sourceWebIntelligence: SourceFn = async (anthropic, regions, icp) => {
  const prospects: RawProspect[] = [];
  const cities = regions
    .filter((r) => r.region_type === "city")
    .map((r) => ({ city: r.region_value, state: r.state }));

  // Derive cities from zip code states if no city regions
  if (cities.length === 0) {
    const states = [...new Set(regions.map((r) => r.state))];
    for (const s of states.slice(0, 2)) {
      cities.push({ city: s, state: s });
    }
  }

  const accountTypes = icp.criteria
    .filter((c) => c.criteria_type === "account_type")
    .map((c) => c.criteria_value);
  const verticals = icp.criteria
    .filter((c) => c.criteria_type === "vertical")
    .map((c) => c.criteria_value);

  console.log(
    `[agent][web] Starting — ${cities.length} cities, accountTypes: [${accountTypes.join(", ")}], verticals: [${verticals.join(", ")}]`
  );

  for (const { city, state } of cities.slice(0, 3)) {
    if (isTimeUp()) {
      console.log("[agent][web] Time limit reached — stopping");
      break;
    }

    try {
      const searchQueries = [
        `${city} ${state} commercial property management companies`,
        `${city} ${state} REIT properties commercial`,
        `${city} ${state} industrial warehouse property owner`,
        `${city} ${state} retail strip center property manager`,
      ];

      const verticalContext =
        verticals.length > 0
          ? `Target verticals: ${verticals.join(", ")}`
          : "Any commercial property vertical";
      const accountContext =
        accountTypes.length > 0
          ? `Target account types: ${accountTypes.join(", ")}`
          : "Any commercial property account type";

      console.log(`[agent][web] Calling Claude for ${city}, ${state}`);
      const result = await callClaude(
        anthropic,
        "You are a B2B commercial property lead generation specialist. You find companies and contacts for commercial roofing business development.",
        `Search the web for commercial property companies in ${city}, ${state}.\n\nRun these searches:\n${searchQueries.map((q) => `- "${q}"`).join("\n")}\n\n${verticalContext}\n${accountContext}\n\nFor each company you find, return a JSON array of objects:\n- company_name\n- website (if found)\n- address_line1 (if found)\n- city: "${city}"\n- state: "${state}"\n- postal_code (if found)\n- account_type (one of: owner, commercial_property_management, facilities_management, asset_management, general_contractor, developer, broker)\n- vertical (one of: commercial_office, retail, industrial_warehouse, healthcare, education, hospitality, multifamily, mixed_use)\n- contact_first_name (if found)\n- contact_last_name (if found)\n- contact_title (if found)\n- email (if found)\n- phone (if found)\n\nReturn ONLY valid JSON array. Aim for 5-15 high-quality results. If nothing found, return [].`
      );

      const parsed = safeParseJsonArray(result);
      console.log(
        `[agent][web] Claude returned ${parsed.length} prospects for ${city}, ${state}`
      );

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
      console.error(`[agent][web] Error for ${city}, ${state}:`, err);
    }
  }

  console.log(`[agent][web] Done — ${prospects.length} total prospects`);
  return { source_detail: "web_intelligence", prospects };
};

// ── Source registry — add new sources here ────────────────────────────────────

const SOURCES: { name: string; fn: SourceFn }[] = [
  { name: "sec_edgar", fn: sourceSecEdgar },
  { name: "openstreetmap", fn: sourceOpenStreetMap },
  { name: "web_intelligence", fn: sourceWebIntelligence },
  // TODO: Add BatchData source here when API key is available
  // { name: "batchdata", fn: sourceBatchData },
  // TODO: Add PropTracer source here when API key is available
  // { name: "proptracer", fn: sourcePropTracer },
];

// ── Utilities ────────────────────────────────────────────────────────────────

function safeParseJsonArray(text: string): Record<string, unknown>[] {
  try {
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
    return (
      url
        .replace(/^(https?:\/\/)?(www\.)?/i, "")
        .split("/")[0]
        .toLowerCase() || null
    );
  }
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
    console.error(`[agent] Failed to create agent run for org ${orgId}:`, runErr);
    return;
  }

  const runId = agentRun.id;
  console.log(`[agent] ===== Agent run ${runId} started for org ${orgId} =====`);

  let totalFound = 0;
  let totalAdded = 0;
  let totalSkipped = 0;
  const sourceBreakdown: Record<
    string,
    { found: number; added: number; skipped: number }
  > = {};
  let finalStatus: "completed" | "failed" = "completed";
  let errorMessage: string | null = null;

  try {
    // Fetch active ICP profiles for this org
    const { data: icpProfiles, error: icpErr } = await supabase
      .from("icp_profiles")
      .select("id,org_id,name,territory_id")
      .eq("org_id", orgId)
      .eq("active", true);

    if (icpErr) {
      console.error(`[agent] ICP profiles query error:`, icpErr);
    }

    console.log(
      `[agent] Found ${icpProfiles?.length ?? 0} active ICP profiles for org ${orgId}`
    );

    if (!icpProfiles || icpProfiles.length === 0) {
      errorMessage = "No active ICP profiles found";
      console.log(`[agent] ${errorMessage} — ending run`);
      return; // finally block will update status
    }

    for (const profile of icpProfiles) {
      if (isTimeUp()) {
        console.log("[agent] Time limit reached — stopping profile loop");
        errorMessage = "Stopped early due to time limit";
        break;
      }

      console.log(
        `[agent] Processing ICP "${profile.name}" (id: ${profile.id}, territory_id: ${profile.territory_id})`
      );

      // Fetch criteria for this ICP
      const { data: criteria } = await supabase
        .from("icp_criteria")
        .select("criteria_type,criteria_value")
        .eq("icp_profile_id", profile.id);

      console.log(
        `[agent] ICP "${profile.name}" has ${criteria?.length ?? 0} criteria`
      );
      if (criteria) {
        for (const c of criteria) {
          console.log(`[agent]   - ${c.criteria_type}: ${c.criteria_value}`);
        }
      }

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
        console.log(
          `[agent] Territory ${profile.territory_id} has ${regions.length} regions`
        );
      } else {
        // No territory linked to ICP — use ALL territories for this org
        console.log(
          `[agent] ICP "${profile.name}" has no territory — fetching all org territories`
        );
        const { data: allTerritories } = await supabase
          .from("territories")
          .select("id")
          .eq("org_id", orgId)
          .eq("active", true);

        if (allTerritories && allTerritories.length > 0) {
          const tIds = allTerritories.map((t) => t.id as string);
          const { data: allRegions } = await supabase
            .from("territory_regions")
            .select("region_type,region_value,state")
            .in("territory_id", tIds);
          regions = allRegions ?? [];
          console.log(
            `[agent] Loaded ${regions.length} regions from ${allTerritories.length} org territories`
          );
        }
      }

      if (regions.length === 0) {
        console.log(
          `[agent] Skipping ICP "${profile.name}" — no territory regions found`
        );
        continue;
      }

      for (const r of regions) {
        console.log(`[agent]   region: ${r.region_type}=${r.region_value}, ${r.state}`);
      }

      // Run each source SEQUENTIALLY to avoid rate limits
      for (const source of SOURCES) {
        if (isTimeUp()) {
          console.log(`[agent] Time limit reached — skipping source "${source.name}"`);
          errorMessage = "Stopped early due to time limit";
          break;
        }

        console.log(`[agent] Running source "${source.name}" for ICP "${profile.name}"`);

        try {
          const result = await source.fn(anthropic, regions, icpWithCriteria);
          const { source_detail, prospects } = result;

          if (!sourceBreakdown[source_detail]) {
            sourceBreakdown[source_detail] = {
              found: 0,
              added: 0,
              skipped: 0,
            };
          }

          sourceBreakdown[source_detail].found += prospects.length;
          totalFound += prospects.length;

          console.log(
            `[agent] Source "${source_detail}" returned ${prospects.length} raw prospects — scoring...`
          );

          // Score and insert each prospect
          for (const raw of prospects) {
            const { score: confidence, breakdown } = scoreProspect(
              raw,
              icpWithCriteria.criteria
            );

            console.log(
              `[agent]   "${raw.company_name}" score=${confidence} [${breakdown.join(", ") || "no matches"}]`
            );

            if (confidence < MIN_CONFIDENCE) {
              console.log(
                `[agent]   FILTERED OUT — score ${confidence} < ${MIN_CONFIDENCE}`
              );
              continue;
            }

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
              if (
                insertErr.code === "23505" ||
                insertErr.message?.includes("duplicate") ||
                insertErr.message?.includes("unique")
              ) {
                totalSkipped++;
                sourceBreakdown[source_detail].skipped++;
                console.log(
                  `[agent]   SKIPPED — duplicate: "${raw.company_name}"`
                );
              } else {
                console.error(
                  `[agent]   INSERT ERROR for "${raw.company_name}":`,
                  insertErr
                );
              }
            } else {
              totalAdded++;
              sourceBreakdown[source_detail].added++;
              console.log(
                `[agent]   ADDED — "${raw.company_name}" (score=${confidence})`
              );
            }
          }
        } catch (sourceErr) {
          console.error(`[agent] Source "${source.name}" error:`, sourceErr);
        }
      }
    }
  } catch (err) {
    console.error(`[agent] Agent run ${runId} failed with error:`, err);
    finalStatus = "failed";
    errorMessage = err instanceof Error ? err.message : String(err);
  } finally {
    // ALWAYS update the run record, even if Vercel is about to kill us
    console.log(
      `[agent] ===== Finalizing run ${runId}: status=${finalStatus}, found=${totalFound}, added=${totalAdded}, skipped=${totalSkipped} =====`
    );
    console.log(`[agent] Source breakdown:`, JSON.stringify(sourceBreakdown));

    try {
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
      console.log(`[agent] Run ${runId} record updated successfully`);
    } catch (updateErr) {
      console.error(`[agent] CRITICAL — failed to update run ${runId}:`, updateErr);
    }
  }
}

// ── Route handler ────────────────────────────────────────────────────────────

export const maxDuration = 800; // Vercel Pro max — falls back to plan limit

export async function GET(request: NextRequest) {
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

  const orgIds = [
    ...new Set((activeOrgs ?? []).map((o) => o.org_id as string)),
  ];

  console.log(
    `[agent] Found ${orgIds.length} orgs with active ICP profiles`
  );

  if (orgIds.length === 0) {
    return NextResponse.json({
      ok: true,
      message: "No active ICP profiles found",
    });
  }

  // Run agent for each org sequentially
  const results: { org_id: string; status: string }[] = [];
  for (const orgId of orgIds) {
    if (isTimeUp()) {
      console.log(`[agent] Time limit — skipping org ${orgId}`);
      results.push({ org_id: orgId, status: "skipped_timeout" });
      continue;
    }

    try {
      await runAgentForOrg(supabase, anthropic, orgId);
      results.push({ org_id: orgId, status: "completed" });
    } catch (err) {
      console.error(`[agent] Agent failed for org ${orgId}:`, err);
      results.push({ org_id: orgId, status: "failed" });
    }
  }

  return NextResponse.json({
    ok: true,
    orgs_processed: results.length,
    results,
  });
}
