import { inngest } from "../client";
import { createAdminClient } from "@/lib/supabase/admin";
import Anthropic from "@anthropic-ai/sdk";
import { scoreWithSource, type IcpCriteria } from "@/lib/intel/confidence";
import {
  safeParseJsonArray,
  normalizeDomain,
  callClaude,
  parseAddress,
  delay,
} from "@/lib/intel/utils";

// ── Types ────────────────────────────────────────────────────────────────────

type TerritoryRegion = {
  region_type: string;
  region_value: string;
  state: string;
};

type SourceResult = {
  found: number;
  added: number;
  skipped: number;
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

// ── Helper: derive cities from territory regions ─────────────────────────────

function getCities(regions: TerritoryRegion[]): { city: string; state: string }[] {
  const cities: { city: string; state: string }[] = [];
  const seen = new Set<string>();
  for (const r of regions) {
    if (r.region_type === "city") {
      const key = `${r.region_value.toLowerCase()}|${r.state.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        cities.push({ city: r.region_value, state: r.state });
      }
    }
  }
  return cities;
}

// ── Helper: build ICP-aware search queries ───────────────────────────────────

function buildSearchQueries(
  city: string,
  state: string,
  criteria: IcpCriteria[]
): string[] {
  const queries: string[] = [];
  const accountTypes = criteria
    .filter((c) => c.criteria_type === "account_type")
    .map((c) => c.criteria_value.replace(/_/g, " "));
  const verticals = criteria
    .filter((c) => c.criteria_type === "vertical")
    .map((c) => c.criteria_value.replace(/_/g, " "));

  if (accountTypes.length > 0) {
    queries.push(`${city} ${state} ${accountTypes[0]} commercial`);
  }
  if (verticals.length > 0) {
    queries.push(`${city} ${state} ${verticals[0]} property owner`);
  }
  if (queries.length === 0) {
    queries.push(`${city} ${state} commercial property management companies`);
    queries.push(`${city} ${state} commercial building owner`);
  }

  return queries.slice(0, 3);
}

// ── Helper: build Google Places queries from ICP ─────────────────────────────

function buildPlacesQueries(
  city: string,
  state: string,
  criteria: IcpCriteria[]
): string[] {
  const queries: string[] = [];
  const verticals = criteria
    .filter((c) => c.criteria_type === "vertical")
    .map((c) => c.criteria_value);
  const accountTypes = criteria
    .filter((c) => c.criteria_type === "account_type")
    .map((c) => c.criteria_value);

  for (const v of verticals.slice(0, 1)) {
    const label = v.replace(/_/g, " ");
    queries.push(`${label} property ${city} ${state}`);
  }
  for (const a of accountTypes.slice(0, 1)) {
    const label = a.replace(/_/g, " ");
    queries.push(`${label} ${city} ${state}`);
  }
  if (queries.length === 0) {
    queries.push(`commercial property management ${city} ${state}`);
    queries.push(`commercial building ${city} ${state}`);
  }

  return queries.slice(0, 2);
}

// ── Helper: insert into intel_prospects with dedup ───────────────────────────

async function insertIntelProspect(
  supabase: ReturnType<typeof createAdminClient>,
  prospect: Record<string, unknown>
): Promise<"added" | "skipped" | "error"> {
  const { error } = await supabase.from("intel_prospects").insert(prospect);

  if (!error) return "added";
  if (error.code === "23505" || error.message?.includes("unique")) return "skipped";
  console.error("[agent] insert error:", error.message);
  return "error";
}

// ── EDGAR 3-Step Pipeline ────────────────────────────────────────────────────

async function sourceEdgar(
  supabase: ReturnType<typeof createAdminClient>,
  anthropic: Anthropic,
  criteria: IcpCriteria[],
  regions: TerritoryRegion[],
  agentRunId: string
): Promise<SourceResult> {
  const result: SourceResult = { found: 0, added: 0, skipped: 0 };
  const EDGAR_USER_AGENT = "Dilly-BD-OS admin@dilly.dev";
  const targetStates = new Set(regions.map((r) => r.state.toUpperCase()));

  console.log("[edgar] Starting EDGAR pipeline");

  // Step 1: Fetch REIT universe from SEC tickers file
  try {
    const resp = await fetch(
      "https://www.sec.gov/files/company_tickers_exchange.json",
      { headers: { "User-Agent": EDGAR_USER_AGENT } }
    );
    if (!resp.ok) {
      console.error(`[edgar] Failed to fetch tickers: ${resp.status}`);
      return result;
    }
    const data = (await resp.json()) as {
      fields: string[];
      data: (string | number)[][];
    };

    const sicCodes = new Set(["6798", "6552", "6512", "6726"]);
    const cikIdx = data.fields.indexOf("cik");
    const nameIdx = data.fields.indexOf("name");
    const tickerIdx = data.fields.indexOf("ticker");
    const exchangeIdx = data.fields.indexOf("exchange");
    const sicIdx = data.fields.indexOf("sic");

    let upserted = 0;
    for (const row of data.data) {
      const sic = String(row[sicIdx] ?? "");
      if (!sicCodes.has(sic)) continue;

      const cik = String(row[cikIdx] ?? "");
      const name = String(row[nameIdx] ?? "");
      if (!cik || !name) continue;

      await supabase.from("reit_universe").upsert(
        {
          cik,
          name,
          ticker: String(row[tickerIdx] ?? "") || null,
          sic,
          exchange: String(row[exchangeIdx] ?? "") || null,
        },
        { onConflict: "cik" }
      );
      upserted++;
    }
    console.log(`[edgar] Step 1: upserted ${upserted} REITs into reit_universe`);
  } catch (err) {
    console.error("[edgar] Step 1 failed:", err);
    return result;
  }

  // Step 2: Fetch 10-K filings for REITs (max 15 per run)
  const { data: reits } = await supabase
    .from("reit_universe")
    .select("*")
    .order("last_10k_date", { ascending: true, nullsFirst: true })
    .limit(15);

  if (!reits || reits.length === 0) {
    console.log("[edgar] No REITs to process");
    return result;
  }

  console.log(`[edgar] Step 2: processing ${reits.length} REITs`);

  for (const reit of reits) {
    await delay(100); // SEC rate limit

    const cikPadded = String(reit.cik).padStart(10, "0");
    try {
      const submResp = await fetch(
        `https://data.sec.gov/submissions/CIK${cikPadded}.json`,
        { headers: { "User-Agent": EDGAR_USER_AGENT } }
      );
      if (!submResp.ok) {
        console.log(`[edgar] Submissions ${submResp.status} for CIK ${reit.cik}`);
        continue;
      }

      const submissions = (await submResp.json()) as {
        filings?: {
          recent?: {
            form?: string[];
            accessionNumber?: string[];
            filingDate?: string[];
          };
        };
      };

      const forms = submissions.filings?.recent?.form ?? [];
      const accessions = submissions.filings?.recent?.accessionNumber ?? [];
      const dates = submissions.filings?.recent?.filingDate ?? [];

      // Find most recent 10-K
      let tenKIndex = -1;
      for (let i = 0; i < forms.length; i++) {
        if (forms[i] === "10-K") {
          tenKIndex = i;
          break;
        }
      }

      if (tenKIndex === -1) {
        console.log(`[edgar] No 10-K found for ${reit.name}`);
        continue;
      }

      const accession = accessions[tenKIndex];
      const filingDate = dates[tenKIndex];

      // Skip if we already processed this filing
      if (reit.last_10k_accession === accession) {
        console.log(`[edgar] Already processed ${accession} for ${reit.name}`);
        continue;
      }

      // Update reit_universe with latest 10-K info
      await supabase
        .from("reit_universe")
        .update({
          last_10k_date: filingDate,
          last_10k_accession: accession,
        })
        .eq("id", reit.id);

      // Step 3: Fetch and parse the 10-K document
      await delay(100);
      const accessionDashed = accession; // already has dashes
      const accessionNoDashes = accession.replace(/-/g, "");
      const filingUrl = `https://www.sec.gov/Archives/edgar/data/${reit.cik}/${accessionNoDashes}/${accessionDashed}.txt`;

      console.log(`[edgar] Step 3: Fetching 10-K for ${reit.name} at ${filingUrl}`);

      const filingResp = await fetch(filingUrl, {
        headers: { "User-Agent": EDGAR_USER_AGENT },
      });
      if (!filingResp.ok) {
        console.log(`[edgar] Filing fetch ${filingResp.status} for ${reit.name}`);
        continue;
      }

      const filingText = await filingResp.text();

      // Extract Item 2 Properties section
      const item2Match = filingText.match(
        /Item\s*2[.\s\-—]*Properties([\s\S]{0,80000}?)(?=Item\s*3|PART\s*II)/i
      );
      if (!item2Match) {
        console.log(`[edgar] No Item 2 Properties found for ${reit.name}`);
        continue;
      }

      const item2Text = item2Match[1].slice(0, 50000);
      console.log(
        `[edgar] Extracted Item 2 (${item2Text.length} chars) for ${reit.name}`
      );

      // Claude extracts property addresses
      const claudeResult = await callClaude(
        anthropic,
        "You extract property addresses from SEC EDGAR 10-K filings. Return ONLY a valid JSON array, no other text.",
        `Extract all property addresses from this Item 2 Properties section of a REIT 10-K filing by ${reit.name}:\n\n${item2Text}\n\nReturn a JSON array of objects with fields: company_name (the REIT name), address_line1, city, state (2-letter code), postal_code, building_type (office/retail/industrial/warehouse/mixed/medical/other), sq_footage (number if mentioned, null otherwise). Return [] if no addresses found. Only include US properties.`
      );

      const properties = safeParseJsonArray(claudeResult);
      console.log(
        `[edgar] Claude extracted ${properties.length} properties for ${reit.name}`
      );

      for (const prop of properties) {
        const propState = String(prop.state ?? "").toUpperCase();
        // Only include properties in target territory states
        if (targetStates.size > 0 && !targetStates.has(propState)) continue;

        const prospect: RawProspect = {
          company_name: String(prop.company_name ?? reit.name),
          address_line1: String(prop.address_line1 ?? ""),
          city: String(prop.city ?? ""),
          state: propState,
          postal_code: String(prop.postal_code ?? ""),
          building_type: String(prop.building_type ?? ""),
          building_sq_footage: prop.sq_footage
            ? Number(prop.sq_footage)
            : undefined,
          account_type: "owner",
          vertical: "commercial_real_estate",
          owner_name_legal: reit.name,
        };

        const { score, breakdown } = scoreWithSource(
          "edgar_10k",
          prospect,
          criteria
        );
        result.found++;

        const status = await insertIntelProspect(supabase, {
          company_name: prospect.company_name,
          domain_normalized: null,
          address_line1: prospect.address_line1 || null,
          city: prospect.city || null,
          state: prospect.state || null,
          postal_code: prospect.postal_code || null,
          building_type: prospect.building_type || null,
          building_sq_footage: prospect.building_sq_footage || null,
          account_type: prospect.account_type,
          vertical: prospect.vertical,
          owner_name_legal: prospect.owner_name_legal,
          confidence_score: score,
          score_breakdown: breakdown,
          source: "agent",
          source_detail: "edgar_10k",
          agent_run_id: agentRunId,
          agent_metadata: {
            cik: reit.cik,
            accession,
            reit_name: reit.name,
          },
        });

        if (status === "added") result.added++;
        else if (status === "skipped") result.skipped++;
      }
    } catch (err) {
      console.error(`[edgar] Error processing ${reit.name}:`, err);
    }
  }

  console.log(
    `[edgar] Done: found=${result.found} added=${result.added} skipped=${result.skipped}`
  );
  return result;
}

// ── Google Places Source ──────────────────────────────────────────────────────

async function sourceGooglePlaces(
  supabase: ReturnType<typeof createAdminClient>,
  criteria: IcpCriteria[],
  regions: TerritoryRegion[],
  agentRunId: string
): Promise<SourceResult> {
  const result: SourceResult = { found: 0, added: 0, skipped: 0 };
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    console.log("[places] GOOGLE_PLACES_API_KEY not set, skipping");
    return result;
  }

  const cities = getCities(regions);
  console.log(`[places] Processing ${cities.length} cities`);

  for (const { city, state } of cities) {
    const queries = buildPlacesQueries(city, state, criteria);
    console.log(`[places] ${city}, ${state}: ${queries.length} queries`);

    for (const query of queries) {
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
            body: JSON.stringify({
              textQuery: query,
              maxResultCount: 20,
            }),
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
        console.log(`[places] Query "${query}": ${places.length} results`);

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

          const { score, breakdown } = scoreWithSource(
            "google_places",
            prospect,
            criteria
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
            lat: prospect.lat ?? null,
            lng: prospect.lng ?? null,
            account_type: prospect.account_type,
            confidence_score: score,
            score_breakdown: breakdown,
            source: "agent",
            source_detail: "google_places",
            agent_run_id: agentRunId,
            agent_metadata: {
              place_types: place.types,
              query,
            },
          });

          if (status === "added") result.added++;
          else if (status === "skipped") result.skipped++;
        }
      } catch (err) {
        console.error(`[places] Error for query "${query}":`, err);
      }

      await delay(200);
    }
  }

  console.log(
    `[places] Done: found=${result.found} added=${result.added} skipped=${result.skipped}`
  );
  return result;
}

// ── Web Intelligence Source ──────────────────────────────────────────────────

async function sourceWebIntelligence(
  supabase: ReturnType<typeof createAdminClient>,
  anthropic: Anthropic,
  criteria: IcpCriteria[],
  regions: TerritoryRegion[],
  agentRunId: string
): Promise<SourceResult> {
  const result: SourceResult = { found: 0, added: 0, skipped: 0 };
  const cities = getCities(regions);

  console.log(`[web-intel] Processing ${cities.length} cities`);

  for (const { city, state } of cities) {
    const queries = buildSearchQueries(city, state, criteria);
    console.log(`[web-intel] ${city}, ${state}: ${queries.length} queries`);

    for (const query of queries) {
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
        console.log(
          `[web-intel] Query "${query}": ${prospects.length} results`
        );

        for (const p of prospects) {
          const companyName = String(p.company_name ?? "");
          if (!companyName) continue;

          const domain = normalizeDomain(
            String(p.website ?? p.company_website ?? "")
          );
          const contactName = String(p.contact_name ?? "");
          const nameParts = contactName.split(/\s+/);

          const prospect: RawProspect = {
            company_name: companyName,
            company_website: String(p.website ?? ""),
            company_phone: String(p.phone ?? ""),
            address_line1: String(p.address_line1 ?? ""),
            city: String(p.city ?? city),
            state: String(p.state ?? state),
            postal_code: String(p.postal_code ?? ""),
            contact_first_name:
              nameParts.length > 0 ? nameParts[0] : undefined,
            contact_last_name:
              nameParts.length > 1
                ? nameParts.slice(1).join(" ")
                : undefined,
            contact_title: String(p.contact_title ?? ""),
            contact_email: String(p.contact_email ?? ""),
            account_type: String(p.account_type ?? ""),
            vertical: String(p.vertical ?? ""),
          };

          const { score, breakdown } = scoreWithSource(
            "web_intelligence",
            prospect,
            criteria
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

        // Stop after first query with 5+ usable results
        if (prospects.length >= 5) {
          console.log(
            `[web-intel] Got ${prospects.length} results, stopping for ${city}`
          );
          break;
        }
      } catch (err) {
        console.error(`[web-intel] Error for query "${query}":`, err);
      }
    }
  }

  console.log(
    `[web-intel] Done: found=${result.found} added=${result.added} skipped=${result.skipped}`
  );
  return result;
}

// ── Main Inngest Function ────────────────────────────────────────────────────

export const prospectingAgent = inngest.createFunction(
  {
    id: "prospecting-agent",
    retries: 1,
    triggers: [{ event: "app/prospecting-agent.run" }],
  },
  async ({ event, step }) => {
    const { org_id } = event.data;
    const supabase = createAdminClient();
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // ── Step: Setup ──────────────────────────────────────────────────────
    const context = await step.run("setup", async () => {
      console.log(`[agent] Starting prospecting agent for org ${org_id}`);

      // Create agent_runs record
      const { data: run, error: runErr } = await supabase
        .from("agent_runs")
        .insert({
          org_id,
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

      // Fetch ICP profiles
      const { data: icpProfiles } = await supabase
        .from("icp_profiles")
        .select("id,name,territory_id,active")
        .eq("org_id", org_id)
        .eq("active", true);

      console.log(
        `[agent] Found ${icpProfiles?.length ?? 0} active ICP profiles`
      );

      if (!icpProfiles || icpProfiles.length === 0) {
        // No ICP profiles — still run with defaults
        const { data: allTerritories } = await supabase
          .from("territories")
          .select("id")
          .eq("org_id", org_id)
          .eq("active", true);

        const territoryIds = (allTerritories ?? []).map(
          (t) => t.id as string
        );

        let allRegions: TerritoryRegion[] = [];
        if (territoryIds.length > 0) {
          const { data: regions } = await supabase
            .from("territory_regions")
            .select("region_type,region_value,state")
            .in("territory_id", territoryIds);
          allRegions = (regions ?? []) as TerritoryRegion[];
        }

        console.log(
          `[agent] No ICP profiles, using ${allRegions.length} regions from ${territoryIds.length} territories`
        );

        return {
          runId: run.id as string,
          profiles: [] as {
            id: string;
            name: string;
            criteria: IcpCriteria[];
            regions: TerritoryRegion[];
          }[],
          fallbackRegions: allRegions,
        };
      }

      // Fetch criteria and regions for each profile
      const profiles = [];
      for (const profile of icpProfiles) {
        const { data: criteria } = await supabase
          .from("icp_criteria")
          .select("criteria_type,criteria_value")
          .eq("icp_profile_id", profile.id);

        let regions: TerritoryRegion[] = [];

        if (profile.territory_id) {
          // Use linked territory
          const { data: r } = await supabase
            .from("territory_regions")
            .select("region_type,region_value,state")
            .eq("territory_id", profile.territory_id);
          regions = (r ?? []) as TerritoryRegion[];
        } else {
          // No territory linked — use ALL org territories
          const { data: allTerritories } = await supabase
            .from("territories")
            .select("id")
            .eq("org_id", org_id)
            .eq("active", true);
          const tIds = (allTerritories ?? []).map((t) => t.id as string);
          if (tIds.length > 0) {
            const { data: r } = await supabase
              .from("territory_regions")
              .select("region_type,region_value,state")
              .in("territory_id", tIds);
            regions = (r ?? []) as TerritoryRegion[];
          }
        }

        console.log(
          `[agent] Profile "${profile.name}": ${(criteria ?? []).length} criteria, ${regions.length} regions`
        );

        profiles.push({
          id: profile.id as string,
          name: profile.name as string,
          criteria: (criteria ?? []) as IcpCriteria[],
          regions,
        });
      }

      return {
        runId: run.id as string,
        profiles,
        fallbackRegions: [] as TerritoryRegion[],
      };
    });

    // Determine regions and criteria to use
    const allCriteria: IcpCriteria[] =
      context.profiles.length > 0
        ? context.profiles.flatMap((p) => p.criteria)
        : [];
    const allRegions: TerritoryRegion[] =
      context.profiles.length > 0
        ? context.profiles.flatMap((p) => p.regions)
        : context.fallbackRegions;

    // Dedup regions
    const regionSet = new Set<string>();
    const uniqueRegions = allRegions.filter((r) => {
      const key = `${r.region_type}|${r.region_value}|${r.state}`;
      if (regionSet.has(key)) return false;
      regionSet.add(key);
      return true;
    });

    console.log(
      `[agent] Total: ${allCriteria.length} criteria, ${uniqueRegions.length} unique regions`
    );

    // ── Step: EDGAR ──────────────────────────────────────────────────────
    const edgarResult = await step.run("source-edgar", async () => {
      return sourceEdgar(
        supabase,
        anthropic,
        allCriteria,
        uniqueRegions,
        context.runId
      );
    });

    // ── Step: Google Places ───────────────────────────────────────────────
    const placesResult = await step.run("source-google-places", async () => {
      return sourceGooglePlaces(
        supabase,
        allCriteria,
        uniqueRegions,
        context.runId
      );
    });

    // ── Step: Web Intelligence ───────────────────────────────────────────
    const webResult = await step.run("source-web-intelligence", async () => {
      return sourceWebIntelligence(
        supabase,
        anthropic,
        allCriteria,
        uniqueRegions,
        context.runId
      );
    });

    // ── Step: Finalize ───────────────────────────────────────────────────
    await step.run("finalize", async () => {
      const totalFound =
        edgarResult.found + placesResult.found + webResult.found;
      const totalAdded =
        edgarResult.added + placesResult.added + webResult.added;
      const totalSkipped =
        edgarResult.skipped + placesResult.skipped + webResult.skipped;

      const sourceBreakdown = {
        edgar_10k: edgarResult,
        google_places: placesResult,
        web_intelligence: webResult,
      };

      console.log(
        `[agent] Finalizing: found=${totalFound} added=${totalAdded} skipped=${totalSkipped}`
      );

      // Update agent_runs
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
        .eq("id", context.runId);

      // Update agent_registry stats
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

      return { totalFound, totalAdded, totalSkipped, sourceBreakdown };
    });
  }
);
