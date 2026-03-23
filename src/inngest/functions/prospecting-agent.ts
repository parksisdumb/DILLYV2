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

// Priority REITs — always process these, never skip
const PRIORITY_REITS = [
  { cik: "0001045609", name: "Prologis Inc", sic: "6798" },
  { cik: "0001063761", name: "Simon Property Group Inc", sic: "6512" },
  { cik: "0000726854", name: "Realty Income Corp", sic: "6798" },
  { cik: "0001695678", name: "VICI Properties Inc", sic: "6798" },
  { cik: "0001393311", name: "Public Storage", sic: "6798" },
  { cik: "0000766704", name: "Welltower Inc", sic: "6798" },
  { cik: "0001035002", name: "Alexandria Real Estate Equities Inc", sic: "6798" },
  { cik: "0000917251", name: "Agree Realty Corp", sic: "6798" },
  { cik: "0001040765", name: "Vornado Realty Trust", sic: "6798" },
];
async function sourceEdgar(
  supabase: ReturnType<typeof createAdminClient>,
  anthropic: Anthropic,
  agentRunId: string
): Promise<SourceResult> {
  const result: SourceResult = { found: 0, added: 0, skipped: 0 };
  const log: string[] = [];
  const EDGAR_USER_AGENT = "Dilly/1.0 parks@sbdllc.co";
  let isFirstReit = true;

  async function secFetch(url: string): Promise<Response> {
    return fetch(url, { headers: { "User-Agent": EDGAR_USER_AGENT } });
  }

  // Helper: extract Item 2 text from filing, trying multiple sources
  async function extractPropertyText(
    filingText: string,
    reitName: string,
    cik: string,
    accessionNoDashes: string
  ): Promise<{ text: string | null; rawHtm: string | null }> {
    let rawHtm: string | null = null;
    try {
      const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNoDashes}/${accessionNoDashes}-index.json`;
      log.push(`Source A: Fetching index.json for ${reitName}`);
      await delay(200);
      const indexResp = await secFetch(indexUrl);

      if (indexResp.ok) {
        const indexData = (await indexResp.json()) as Record<string, unknown>;

        if (isFirstReit) {
          log.push(`index.json keys: ${JSON.stringify(Object.keys(indexData))}`);
          const dir = indexData.directory as { item?: unknown[] } | undefined;
          log.push(`index.json doc count: ${dir?.item?.length ?? "no directory.item"}`);
        }

        const items = (indexData.directory as { item?: { name?: string; type?: string; description?: string }[] })?.item ?? [];
        const tenKDoc = items.find(
          (item) => item.type === "10-K" && item.name && /\.htm/i.test(item.name)
        );

        if (tenKDoc?.name) {
          const htmUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNoDashes}/${tenKDoc.name}`;
          log.push(`Source A: Found 10-K htm: ${tenKDoc.name}`);
          await delay(200);
          const htmResp = await secFetch(htmUrl);
          if (htmResp.ok) {
            rawHtm = await htmResp.text();
            log.push(`Source A: ${rawHtm.length} chars for ${reitName}`);

            const match = rawHtm.match(
              /(?:ITEM\s*2[\s.:\-—]{0,200}?PROPERTIES|PROPERTIES[\s\S]{0,50}?ITEM\s*2)([\s\S]{0,100000}?)(?=ITEM\s*3|PART\s+II\b)/i
            );
            if (match) {
              log.push(`Source A: Item 2 found, ${match[1].length} chars`);
              return { text: match[1].slice(0, 50000), rawHtm };
            }
            log.push(`Source A: Item 2 regex failed for ${reitName}`);
          }
        } else {
          log.push(`Source A: No 10-K .htm in index for ${reitName}`);
        }
      } else {
        log.push(`Source A: index.json ${indexResp.status} for ${reitName}`);
      }
    } catch (err) {
      log.push(`Source A failed for ${reitName}: ${err instanceof Error ? err.message : err}`);
    }

    const item2Match = filingText.match(
      /(?:ITEM\s*2[\s.:\-—]{0,200}?PROPERTIES|PROPERTIES[\s\S]{0,50}?ITEM\s*2)([\s\S]{0,100000}?)(?=ITEM\s*3|PART\s+II\b)/i
    );
    if (item2Match) {
      log.push(`Source B: Item 2 found, ${item2Match[1].length} chars`);
      return { text: item2Match[1].slice(0, 50000), rawHtm };
    }

    const scheduleMatch = filingText.match(
      /SCHEDULE\s+III[\s\S]{0,200}?REAL ESTATE([\s\S]{0,150000}?)(?=SCHEDULE\s+IV|$)/i
    );
    if (scheduleMatch) {
      log.push(`Source C: Schedule III found, ${scheduleMatch[1].length} chars`);
      return { text: scheduleMatch[1].slice(0, 50000), rawHtm };
    }

    log.push(`No property text for ${reitName}. First 500 chars: ${filingText.slice(0, 500).replace(/\s+/g, " ")}`);
    return { text: null, rawHtm };
  }

  try {
    log.push("Starting EDGAR pipeline");

    // Step 1: Seed priority REITs + EFTS discovery
    try {
      for (const pr of PRIORITY_REITS) {
        await supabase.from("intel_entities").upsert(
          { cik: pr.cik, name: pr.name, sic: pr.sic },
          { onConflict: "cik" }
        );
      }
      log.push(`Step 1: Seeded ${PRIORITY_REITS.length} priority REITs`);

      const t0 = Date.now();
      const eftsUrl = "https://efts.sec.gov/LATEST/search-index?q=%22real+estate+investment+trust%22&forms=10-K&dateRange=custom&startdt=2024-01-01&enddt=2025-12-31";
      const resp = await secFetch(eftsUrl);
      log.push(`Step 1: EFTS fetch ${resp.status} in ${Date.now() - t0}ms`);

      if (resp.ok) {
        const data = (await resp.json()) as {
          hits?: { total?: { value?: number }; hits?: { _source?: { ciks?: string[]; display_names?: string[]; sics?: string[] } }[] };
        };

        const VALID_SIC = new Set(["6512", "6552", "6726", "6798"]);
        const GARBAGE_NAME_PATTERNS = /bancorp|banking|financial\s+corp|mortgage\s+trust|bancshares|savings|federal\s+savings|insurance|bancorporation/i;

        const cikMap = new Map<string, { name: string; sic: string }>();
        let filteredOut = 0;
        for (const hit of data.hits?.hits ?? []) {
          const src = hit._source;
          if (!src?.ciks?.[0] || cikMap.has(src.ciks[0])) continue;
          let name = src.display_names?.[0] ?? "";
          name = name.replace(/\s*\(CIK\s+\d+\)\s*$/, "").replace(/\s*\([A-Z, -]+\)\s*/g, " ").trim();
          const sic = src.sics?.[0] ?? "";

          if (sic && !VALID_SIC.has(sic)) { filteredOut++; continue; }
          if (GARBAGE_NAME_PATTERNS.test(name)) { filteredOut++; continue; }

          cikMap.set(src.ciks[0], { name, sic });
        }

        log.push(`Step 1: filtered ${filteredOut} non-REIT, kept ${cikMap.size}`);

        let upserted = 0;
        for (const [cik, info] of cikMap) {
          const { error } = await supabase.from("intel_entities").upsert({ cik, name: info.name, sic: info.sic }, { onConflict: "cik" });
          if (!error) upserted++;
        }
        log.push(`Step 1 success: ${cikMap.size} EFTS + ${PRIORITY_REITS.length} priority, ${upserted} upserted`);
      }
    } catch (err) {
      log.push(`Step 1 FAILED: ${err instanceof Error ? err.message : err}`);
    }

    // Step 2: Process all 9 priority REITs + up to 5 additional
    const priorityCiks = PRIORITY_REITS.map((r) => r.cik);

    const { data: priorityReits } = await supabase
      .from("intel_entities")
      .select("*")
      .in("cik", priorityCiks);

    const { data: additionalReits } = await supabase
      .from("intel_entities")
      .select("*")
      .not("cik", "in", `(${priorityCiks.join(",")})`)
      .is("last_10k_date", null)
      .order("created_at")
      .limit(5);

    const allReits = [...(priorityReits ?? []), ...(additionalReits ?? [])];

    if (allReits.length === 0) {
      log.push("No REITs to process");
      return { ...result, debug: log };
    }

    log.push(`Step 2: ${allReits.length} REITs (${priorityReits?.length ?? 0} priority + ${additionalReits?.length ?? 0} additional): ${allReits.map((r) => r.name).join(", ")}`);

    for (const reit of allReits) {
      if (isCapReached()) { log.push("Global cap reached, stopping"); break; }
      await delay(200);

      const cikPadded = String(reit.cik).padStart(10, "0");
      try {
        const submUrl = `https://data.sec.gov/submissions/CIK${cikPadded}.json`;
        const t1 = Date.now();
        const submResp = await secFetch(submUrl);
        log.push(`${reit.name} submissions: ${submResp.status} in ${Date.now() - t1}ms`);
        if (!submResp.ok) continue;

        const submissions = (await submResp.json()) as {
          filings?: { recent?: { form?: string[]; accessionNumber?: string[]; filingDate?: string[]; primaryDocument?: string[] } };
        };

        const forms = submissions.filings?.recent?.form ?? [];
        const accessions = submissions.filings?.recent?.accessionNumber ?? [];
        const dates = submissions.filings?.recent?.filingDate ?? [];
        const primaryDocs = submissions.filings?.recent?.primaryDocument ?? [];

        let tenKIndex = -1;
        for (let i = 0; i < forms.length; i++) {
          if (forms[i] === "10-K") { tenKIndex = i; break; }
        }
        if (tenKIndex === -1) {
          log.push(`${reit.name}: No 10-K found. Forms: ${[...new Set(forms.slice(0, 10))].join(",")}`);
          continue;
        }

        const accession = accessions[tenKIndex];
        const filingDate = dates[tenKIndex];
        const primaryDoc = primaryDocs[tenKIndex] || null;
        log.push(`${reit.name}: 10-K accession=${accession} date=${filingDate}`);

        // Skip if already processed — applies to ALL REITs including priority
        if (reit.last_10k_accession === accession) {
          log.push(`SKIPPED: ${reit.name} already processed accession ${accession}`);
          continue;
        }

        await supabase.from("intel_entities")
          .update({ last_10k_date: filingDate, last_10k_accession: accession })
          .eq("id", reit.id);

        // Step 3: Fetch filing document
        await delay(200);
        const accessionNoDashes = accession.replace(/-/g, "");
        const docFilename = primaryDoc || `${accession}.txt`;
        const filingUrl = `https://www.sec.gov/Archives/edgar/data/${reit.cik}/${accessionNoDashes}/${docFilename}`;

        const t2 = Date.now();
        const filingResp = await secFetch(filingUrl);
        log.push(`${reit.name} filing fetch: ${filingResp.status} in ${Date.now() - t2}ms`);
        if (!filingResp.ok) continue;

        const filingText = await filingResp.text();
        log.push(`${reit.name}: filing ${filingText.length} chars`);

        // Extract property text using Source A/B/C cascade
        const extraction = await extractPropertyText(filingText, reit.name, reit.cik as string, accessionNoDashes);
        isFirstReit = false;

        // Two-pass extraction: one Claude call classifies Type A vs Type B
        const textForClaude = extraction.text ?? extraction.rawHtm?.slice(0, 80000) ?? null;
        if (textForClaude) {
          const classifyResult = await callClaude(
            anthropic,
            "You analyze REIT 10-K filings. Return ONLY a valid JSON object, no other text.",
            `Analyze this Item 2 Properties section from a REIT 10-K filing by ${reit.name}. First determine the format:
- Type A: lists individual property addresses (street address, city, state)
- Type B: lists properties grouped by market/city/tenant with counts but no street addresses

Return a JSON object with:
- type: "A" or "B"
- properties: array (for Type A — each item has address_line1, city, state, postal_code, building_type, sq_footage as number or null). Only US properties.
- markets: array (for Type B — each item has market_name, building_count as number, total_sqft as number or null, state_code as 2-letter code, primary_building_type)
- tenants: array (top tenants if mentioned — each has tenant_name, tenant_industry, property_count as number or null, pct_of_rent as number or null)
- summary: one sentence describing what was found

${textForClaude.slice(0, 50000)}`
          );

          const parsed = safeParseJsonObject(classifyResult);
          const reitType = String(parsed?.type ?? "B");
          const properties = Array.isArray(parsed?.properties) ? (parsed.properties as Record<string, unknown>[]) : [];
          const markets = Array.isArray(parsed?.markets) ? (parsed.markets as Record<string, unknown>[]) : [];
          const tenants = Array.isArray(parsed?.tenants) ? (parsed.tenants as Record<string, unknown>[]) : [];
          const summary = String(parsed?.summary ?? "");

          log.push(`${reit.name}: Type=${reitType}, props=${properties.length}, markets=${markets.length}, tenants=${tenants.length}. ${summary}`);

          if (reitType === "A" && properties.length > 0) {
            for (const prop of properties) {
              if (isCapReached()) break;
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
                entity_id: reit.id,
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
          } else if (markets.length > 0) {
            const existing = (reit.portfolio_summary as Record<string, unknown>) ?? {};
            await supabase.from("intel_entities").update({
              portfolio_summary: { ...existing, property_markets: markets },
            }).eq("id", reit.id);

            for (const mkt of markets) {
              if (isCapReached()) break;
              const marketName = String(mkt.market_name ?? "");
              const stateCode = String(mkt.state_code ?? "").toUpperCase();
              const totalSqft = mkt.total_sqft ? Number(mkt.total_sqft) : undefined;
              const buildingCount = mkt.building_count ? Number(mkt.building_count) : undefined;
              const buildingType = String(mkt.primary_building_type ?? "");

              const prospect: RawProspect = {
                company_name: reit.name as string,
                city: marketName,
                state: stateCode,
                account_type: "owner",
                vertical: "commercial_real_estate",
                owner_name_legal: reit.name as string,
                building_type: buildingType,
                building_sq_footage: totalSqft,
              };

              const { score, breakdown } = scoreWithSource("edgar_10k", prospect);
              result.found++;

              const status = await insertIntelProspect(supabase, {
                company_name: reit.name as string,
                domain_normalized: null,
                address_line1: null,
                city: marketName || null,
                state: stateCode || null,
                postal_code: null,
                building_type: buildingType || null,
                building_sq_footage: totalSqft ?? null,
                account_type: "owner",
                vertical: "commercial_real_estate",
                owner_name_legal: reit.name as string,
                entity_id: reit.id,
                confidence_score: score,
                score_breakdown: breakdown,
                source: "agent",
                source_detail: "edgar_10k",
                agent_run_id: agentRunId,
                agent_metadata: {
                  cik: reit.cik, accession, reit_name: reit.name,
                  building_count: buildingCount, market_name: marketName,
                },
              });

              if (status === "added") result.added++;
              else if (status === "skipped") result.skipped++;
            }
          }

          // Insert tenants into intel_tenants table
          if (tenants.length > 0) {
            let tenantInserted = 0;
            for (const t of tenants) {
              const tenantName = String(t.tenant_name ?? "");
              if (!tenantName) continue;
              const propCount = t.property_count ? Number(t.property_count) : null;
              const { error: tErr } = await supabase.from("intel_tenants").insert({
                intel_entity_id: reit.id,
                tenant_name: tenantName,
                tenant_industry: String(t.tenant_industry ?? "") || null,
                property_count: propCount,
                pct_of_rent: t.pct_of_rent ? Number(t.pct_of_rent) : null,
                national_account: propCount != null && propCount > 10,
                source_detail: "edgar_10k",
                agent_metadata: { cik: reit.cik, accession },
              });
              if (!tErr) tenantInserted++;
            }
            log.push(`${reit.name}: ${tenantInserted} tenants inserted`);
          }
        } else {
          log.push(`${reit.name}: No text for Claude (extraction empty)`);
        }

        // Exhibit 21 subsidiary extraction
        try {
          const indexUrl = `https://www.sec.gov/Archives/edgar/data/${reit.cik}/${accessionNoDashes}/${accessionNoDashes}-index.json`;
          await delay(200);
          const idxResp = await secFetch(indexUrl);
          if (idxResp.ok) {
            const idxData = (await idxResp.json()) as { directory?: { item?: { name?: string; description?: string }[] } };
            const ex21 = (idxData.directory?.item ?? []).find(
              (item) => /21|subsidiaries/i.test(item.description ?? "")
            );
            if (ex21?.name) {
              await delay(200);
              const ex21Url = `https://www.sec.gov/Archives/edgar/data/${reit.cik}/${accessionNoDashes}/${ex21.name}`;
              const ex21Resp = await secFetch(ex21Url);
              if (ex21Resp.ok) {
                const ex21Text = (await ex21Resp.text()).slice(0, 30000);
                const subResult = await callClaude(
                  anthropic,
                  "You extract property hints from subsidiary lists. Return ONLY a valid JSON array.",
                  `Extract property hints from this subsidiary list. Many LLC names contain city and state. Return JSON array with fields: llc_name, inferred_city, inferred_state (2-letter), inferred_tenant (retailer name if present). Return [] if no location hints found.\n\n${ex21Text}`
                );
                const subsidiaries = safeParseJsonArray(subResult);
                log.push(`${reit.name}: Exhibit 21: ${subsidiaries.length} subsidiary hints`);

                if (subsidiaries.length > 0) {
                  const existing = (reit.portfolio_summary as Record<string, unknown>) ?? {};
                  await supabase.from("intel_entities").update({
                    portfolio_summary: { ...existing, subsidiary_hints: subsidiaries },
                  }).eq("id", reit.id);
                }
              }
            }
          }
        } catch (err) {
          log.push(`${reit.name}: Exhibit 21 failed: ${err instanceof Error ? err.message : err}`);
        }

        // Management contact extraction → intel_contacts
        try {
          const mgmtResult = await callClaude(
            anthropic,
            "You extract executive contacts from SEC filings. Return ONLY a valid JSON array.",
            `From this 10-K filing text, extract the names and titles of executives: CEO, CFO, VP/SVP of Asset Management, VP/SVP of Property Operations, Chief Investment Officer. Return JSON array with fields: name, title. Return [] if none found.\n\n${filingText.slice(0, 15000)}`
          );
          const mgmtContacts = safeParseJsonArray(mgmtResult);

          let contactsInserted = 0;
          for (const mc of mgmtContacts) {
            const fullName = String(mc.name ?? "");
            const title = String(mc.title ?? "");
            if (!fullName) continue;
            const nameParts = fullName.split(/\s+/);
            const contactType = /asset\s*manage|property\s*op/i.test(title)
              ? "asset_manager"
              : "executive";

            const { error: cErr } = await supabase.from("intel_contacts").insert({
              intel_entity_id: reit.id,
              first_name: nameParts[0] || null,
              last_name: nameParts.length > 1 ? nameParts.slice(1).join(" ") : null,
              full_name: fullName,
              title,
              contact_type: contactType,
              source_detail: "edgar_10k",
              agent_metadata: { cik: reit.cik, accession },
            });
            if (!cErr) contactsInserted++;
          }
          log.push(`${reit.name}: ${contactsInserted} contacts inserted`);
        } catch (err) {
          log.push(`${reit.name}: Mgmt extraction failed: ${err instanceof Error ? err.message : err}`);
        }

        // Recent acquisitions extraction
        try {
          const mdaMatch = filingText.match(
            /(?:ITEM\s*7[\s.:\-—]{0,200}?MANAGEMENT.S DISCUSSION|MD&A)([\s\S]{0,100000}?)(?=ITEM\s*8|PART\s+III\b)/i
          );
          if (mdaMatch) {
            const acqResult = await callClaude(
              anthropic,
              "You extract recent property acquisitions from SEC filings. Return ONLY a valid JSON array.",
              `Extract properties acquired in the most recent fiscal year from this MD&A section. Return JSON array with: property_name, address_line1, city, state (2-letter), price_millions (number or null), property_type, acquisition_date (YYYY-MM-DD or null). Return [] if no acquisitions found.\n\n${mdaMatch[1].slice(0, 30000)}`
            );
            const acquisitions = safeParseJsonArray(acqResult);
            log.push(`${reit.name}: ${acquisitions.length} acquisitions found`);

            for (const acq of acquisitions) {
              if (isCapReached()) break;
              const prospect: RawProspect = {
                company_name: String(acq.property_name ?? reit.name),
                address_line1: String(acq.address_line1 ?? ""),
                city: String(acq.city ?? ""),
                state: String(acq.state ?? "").toUpperCase(),
                building_type: String(acq.property_type ?? ""),
                account_type: "owner",
                vertical: "commercial_real_estate",
                owner_name_legal: reit.name,
              };

              const { score, breakdown } = scoreWithSource("edgar_10k", prospect);
              const boostedScore = Math.min(100, score + 20);
              result.found++;

              const status = await insertIntelProspect(supabase, {
                company_name: prospect.company_name,
                domain_normalized: null,
                address_line1: prospect.address_line1 || null,
                city: prospect.city || null,
                state: prospect.state || null,
                building_type: prospect.building_type || null,
                account_type: prospect.account_type,
                vertical: prospect.vertical,
                owner_name_legal: prospect.owner_name_legal,
                entity_id: reit.id,
                new_owner_signal: true,
                confidence_score: boostedScore,
                score_breakdown: [...breakdown, "+20 new_acquisition"],
                source: "agent",
                source_detail: "edgar_10k",
                agent_run_id: agentRunId,
                agent_metadata: {
                  cik: reit.cik, accession, reit_name: reit.name,
                  acquisition_date: acq.acquisition_date,
                  price_millions: acq.price_millions,
                },
              });

              if (status === "added") result.added++;
              else if (status === "skipped") result.skipped++;
            }
          }
        } catch (err) {
          log.push(`${reit.name}: Acquisitions failed: ${err instanceof Error ? err.message : err}`);
        }

      } catch (err) {
        log.push(`ERROR processing ${reit.name}: ${err instanceof Error ? err.message : err}`);
      }
    }

    log.push(`Done: found=${result.found} added=${result.added} skipped=${result.skipped}`);
    return { ...result, debug: log };

  } catch (outerErr) {
    const msg = outerErr instanceof Error ? outerErr.message : String(outerErr);
    log.push(`FATAL: ${msg}`);
    return { ...result, debug: log };
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
