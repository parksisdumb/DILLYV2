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

// ── EDGAR 3-Step Pipeline (global — no org/territory filtering) ──────────────

async function sourceEdgar(
  supabase: ReturnType<typeof createAdminClient>,
  anthropic: Anthropic,
  agentRunId: string
): Promise<SourceResult> {
  const result: SourceResult = { found: 0, added: 0, skipped: 0 };
  const EDGAR_USER_AGENT = "Dilly-BD-OS admin@dilly.dev";

  console.log("[edgar] Starting EDGAR pipeline (global)");

  // Step 1: Fetch REIT universe from SEC tickers file
  try {
    const t0 = Date.now();
    console.log("[edgar] Step 1: Fetching company_tickers_exchange.json...");
    const resp = await fetch(
      "https://www.sec.gov/files/company_tickers_exchange.json",
      { headers: { "User-Agent": EDGAR_USER_AGENT } }
    );
    console.log(`[edgar] Step 1: Fetch completed in ${Date.now() - t0}ms, status=${resp.status}`);
    if (!resp.ok) {
      console.error(`[edgar] Failed to fetch tickers: ${resp.status} ${resp.statusText}`);
      return result;
    }
    const data = (await resp.json()) as {
      fields: string[];
      data: (string | number)[][];
    };

    console.log(`[edgar] Step 1: tickers JSON fields=${JSON.stringify(data.fields)}, total rows=${data.data?.length ?? 0}`);

    const sicCodes = new Set(["6798", "6552", "6512", "6726"]);
    const cikIdx = data.fields.indexOf("cik");
    const nameIdx = data.fields.indexOf("name");
    const tickerIdx = data.fields.indexOf("ticker");
    const exchangeIdx = data.fields.indexOf("exchange");
    const sicIdx = data.fields.indexOf("sic");

    console.log(`[edgar] Step 1: field indexes — cik=${cikIdx} name=${nameIdx} ticker=${tickerIdx} exchange=${exchangeIdx} sic=${sicIdx}`);

    if (sicIdx === -1) {
      console.error("[edgar] Step 1: 'sic' field not found in tickers JSON! Fields:", data.fields);
      return result;
    }

    let upserted = 0;
    let sicMatched = 0;
    for (const row of data.data) {
      const sic = String(row[sicIdx] ?? "");
      if (!sicCodes.has(sic)) continue;
      sicMatched++;

      const cik = String(row[cikIdx] ?? "");
      const name = String(row[nameIdx] ?? "");
      if (!cik || !name) continue;

      const { error: upsertErr } = await supabase.from("reit_universe").upsert(
        {
          cik,
          name,
          ticker: String(row[tickerIdx] ?? "") || null,
          sic,
          exchange: String(row[exchangeIdx] ?? "") || null,
        },
        { onConflict: "cik" }
      );
      if (upsertErr) {
        console.error(`[edgar] Step 1: upsert error for CIK ${cik}:`, upsertErr.message);
      } else {
        upserted++;
      }
    }
    console.log(`[edgar] Step 1: SIC matched=${sicMatched}, upserted=${upserted} REITs into reit_universe`);
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
    await delay(100);

    const cikPadded = String(reit.cik).padStart(10, "0");
    try {
      const t1 = Date.now();
      const submResp = await fetch(
        `https://data.sec.gov/submissions/CIK${cikPadded}.json`,
        { headers: { "User-Agent": EDGAR_USER_AGENT } }
      );
      console.log(`[edgar] Step 2: Submissions fetch for ${reit.name} (CIK ${cikPadded}): ${submResp.status} in ${Date.now() - t1}ms`);
      if (!submResp.ok) {
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

      console.log(`[edgar] Step 2: ${reit.name} (CIK ${reit.cik}) — ${forms.length} recent filings found`);

      let tenKIndex = -1;
      for (let i = 0; i < forms.length; i++) {
        if (forms[i] === "10-K") { tenKIndex = i; break; }
      }

      if (tenKIndex === -1) {
        console.log(`[edgar] Step 2: No 10-K in filings for ${reit.name}. Form types seen: ${[...new Set(forms.slice(0, 20))].join(", ")}`);
        continue;
      }

      const accession = accessions[tenKIndex];
      const filingDate = dates[tenKIndex];
      console.log(`[edgar] Step 2: ${reit.name} — 10-K found: accession=${accession}, date=${filingDate}`);

      if (reit.last_10k_accession === accession) {
        console.log(`[edgar] Already processed ${accession} for ${reit.name}`);
        continue;
      }

      await supabase
        .from("reit_universe")
        .update({ last_10k_date: filingDate, last_10k_accession: accession })
        .eq("id", reit.id);

      // Step 3: Fetch and parse the 10-K document
      await delay(100);
      const accessionNoDashes = accession.replace(/-/g, "");
      const filingUrl = `https://www.sec.gov/Archives/edgar/data/${reit.cik}/${accessionNoDashes}/${accession}.txt`;

      const t2 = Date.now();
      console.log(`[edgar] Step 3: Fetching 10-K for ${reit.name} at ${filingUrl}`);

      const filingResp = await fetch(filingUrl, {
        headers: { "User-Agent": EDGAR_USER_AGENT },
      });
      console.log(`[edgar] Step 3: Filing fetch for ${reit.name}: ${filingResp.status} in ${Date.now() - t2}ms`);
      if (!filingResp.ok) {
        continue;
      }

      const filingText = await filingResp.text();
      console.log(`[edgar] Step 3: ${reit.name} — fetched filing, ${filingText.length} chars`);

      const item2Match = filingText.match(
        /Item\s*2[.\s\-—]*Properties([\s\S]{0,80000}?)(?=Item\s*3|PART\s*II)/i
      );
      if (!item2Match) {
        // Log a snippet to help debug why regex didn't match
        const snippet = filingText.slice(0, 500).replace(/\s+/g, " ");
        console.log(`[edgar] Step 3: No Item 2 Properties match for ${reit.name}. First 500 chars: ${snippet}`);
        continue;
      }

      const item2Text = item2Match[1].slice(0, 50000);
      console.log(`[edgar] Step 3: ${reit.name} — extracted Item 2 section, ${item2Text.length} chars`);

      const claudeResult = await callClaude(
        anthropic,
        "You extract property addresses from SEC EDGAR 10-K filings. Return ONLY a valid JSON array, no other text.",
        `Extract all property addresses from this Item 2 Properties section of a REIT 10-K filing by ${reit.name}:\n\n${item2Text}\n\nReturn a JSON array of objects with fields: company_name (the REIT name), address_line1, city, state (2-letter code), postal_code, building_type (office/retail/industrial/warehouse/mixed/medical/other), sq_footage (number if mentioned, null otherwise). Return [] if no addresses found. Only include US properties.`
      );

      const properties = safeParseJsonArray(claudeResult);
      console.log(`[edgar] Step 3: Claude returned ${claudeResult.length} chars, parsed ${properties.length} properties for ${reit.name}`);
      if (properties.length === 0) {
        console.log(`[edgar] Step 3: Claude raw response (first 500 chars): ${claudeResult.slice(0, 500)}`);
      }
      if (properties.length > 0) {
        console.log(`[edgar] Step 3: First property sample: ${JSON.stringify(properties[0])}`);
      }

      // Insert ALL properties globally — no territory filtering
      for (const prop of properties) {
        const prospect: RawProspect = {
          company_name: String(prop.company_name ?? reit.name),
          address_line1: String(prop.address_line1 ?? ""),
          city: String(prop.city ?? ""),
          state: String(prop.state ?? "").toUpperCase(),
          postal_code: String(prop.postal_code ?? ""),
          building_type: String(prop.building_type ?? ""),
          building_sq_footage: prop.sq_footage ? Number(prop.sq_footage) : undefined,
          account_type: "owner",
          vertical: "commercial_real_estate",
          owner_name_legal: reit.name,
        };

        const { score, breakdown } = scoreWithSource("edgar_10k", prospect);
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
          agent_metadata: { cik: reit.cik, accession, reit_name: reit.name },
        });

        if (status === "added") result.added++;
        else if (status === "skipped") result.skipped++;
      }
    } catch (err) {
      console.error(`[edgar] Error processing ${reit.name}:`, err);
    }
  }

  console.log(`[edgar] Done: found=${result.found} added=${result.added} skipped=${result.skipped}`);
  return result;
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
    triggers: [{ event: "app/prospecting-agent.run" }],
  },
  async ({ step }) => {
    const supabase = createAdminClient();
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Reset global insert counter for this run
    globalInsertCount = 0;

    let runId: string | null = null;
    let errorMessage: string | null = null;
    const edgarResult: SourceResult = { found: 0, added: 0, skipped: 0 };
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
          const totalFound = edgarResult.found + placesResult.found + webResult.found;
          const totalAdded = edgarResult.added + placesResult.added + webResult.added;
          const totalSkipped = edgarResult.skipped + placesResult.skipped + webResult.skipped;

          const sourceBreakdown = {
            edgar_10k: edgarResult,
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
