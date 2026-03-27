// Step 3: Fetch a 10-K document, extract portfolio intelligence from Item 2
// Returns entity-level intelligence (stored on intel_entities) plus
// individual addresses only when Type A filing (stored in intel_prospects)

import Anthropic from "@anthropic-ai/sdk";
import { safeParseJsonArray, callClaude } from "@/lib/intel/utils";

const SEC_USER_AGENT = "Dilly/1.0 parks@sbdllc.co";

// ── Types ────────────────────────────────────────────────────────────────────

export type PortfolioIntelligence = {
  total_properties: number | null;
  markets: Array<{
    name: string;
    state: string | null;
    property_count: number | null;
    sq_footage_sf: number | null;
    property_type: string;
  }>;
  capex_annual_usd: number | null;
  subsidiaries: string[];
  decision_makers: Array<{
    name: string;
    title: string;
    contact_type: string;
  }>;
  filing_type: "type_a" | "type_b" | "type_c";
  raw_item2_length: number;
};

export type TypeAAddress = {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  property_type: string;
  sq_footage: number | null;
  tenant: string | null;
  confidence_boost: number;
};

export type ExtractionResult = {
  portfolio: PortfolioIntelligence;
  addresses: TypeAAddress[]; // Only populated for type_a filings
};

// ── Prompts ──────────────────────────────────────────────────────────────────

const PORTFOLIO_PROMPT =
  "You are extracting portfolio intelligence from a REIT 10-K Item 2 section. " +
  "Return a single JSON object (not an array) with these fields:\n" +
  "- total_properties: total property count if stated (number or null)\n" +
  "- markets: array of {name, state, property_count, sq_footage_sf, property_type} " +
  "for each market or region mentioned\n" +
  "- capex_annual_usd: annual capital expenditure in dollars if mentioned (number or null)\n" +
  "- subsidiaries: array of subsidiary/LLC names found in the text\n" +
  "- decision_makers: array of {name, title, contact_type} for any executives or " +
  "contacts mentioned (contact_type: executive, asset_manager, property_manager)\n" +
  "- filing_type: 'type_a' if individual property addresses are listed, 'type_b' " +
  "if only market summaries, 'type_c' if minimal property info\n\n" +
  "Return ONLY valid JSON, no explanation.";

const ADDRESS_PROMPT =
  "You are extracting individual property addresses from a REIT 10-K filing " +
  "Item 2 section. This REIT lists specific property addresses. " +
  "Return ONLY a valid JSON array, no explanation, no markdown. " +
  "Each object: { address: string|null, city: string|null, state: string|null, " +
  "zip: string|null, property_type: 'office'|'industrial'|'retail'|'multifamily'" +
  "|'healthcare'|'self_storage'|'mixed'|'unknown', sq_footage: number|null, " +
  "tenant: string|null, confidence_boost: number 0-30 }";

// ── Street address detection ─────────────────────────────────────────────────

const STREET_ADDRESS_RE =
  /\d+\s+[A-Za-z]+\s+(St|Ave|Blvd|Dr|Rd|Way|Ln|Pkwy|Hwy|Road|Street|Avenue|Boulevard|Drive|Lane|Parkway|Highway|Circle|Court|Place|Square|Trail)/gi;

// ── Main function ────────────────────────────────────────────────────────────

const EMPTY_PORTFOLIO: PortfolioIntelligence = {
  total_properties: null,
  markets: [],
  capex_annual_usd: null,
  subsidiaries: [],
  decision_makers: [],
  filing_type: "type_c",
  raw_item2_length: 0,
};

export async function extractItem2Properties(
  documentUrl: string,
  reitName: string
): Promise<ExtractionResult> {
  try {
    await new Promise((r) => setTimeout(r, 200));
    const resp = await fetch(documentUrl, {
      headers: { "User-Agent": SEC_USER_AGENT },
    });

    if (!resp.ok) {
      console.log(`[edgar-item2] ${reitName}: document fetch failed ${resp.status}`);
      return { portfolio: { ...EMPTY_PORTFOLIO }, addresses: [] };
    }

    const html = await resp.text();
    const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ");

    // Find best Item 2 → Item 3 section
    const item2Regex = /item\s+2\.?\s*properties/gi;
    let item2Match: RegExpExecArray | null = null;
    let bestStart = -1;
    let bestEnd = -1;

    while ((item2Match = item2Regex.exec(text)) !== null) {
      const afterIdx = item2Match.index + item2Match[0].length;
      const item3Match = text
        .slice(afterIdx)
        .match(/item\s+3\.?\s*legal\s+proceedings/i);
      if (!item3Match || item3Match.index === undefined) continue;

      const sectionLen = item3Match.index;
      if (sectionLen > bestEnd - bestStart) {
        bestStart = item2Match.index;
        bestEnd = afterIdx + item3Match.index;
      }
    }

    if (bestStart === -1) {
      console.log(`[edgar-item2] ${reitName}: no valid Item 2 → Item 3 section found`);
      return { portfolio: { ...EMPTY_PORTFOLIO }, addresses: [] };
    }

    const item2Text = text.slice(bestStart, bestEnd).trim();

    if (item2Text.length < 200) {
      console.log(`[edgar-item2] ${reitName}: Item 2 too short (${item2Text.length} chars)`);
      return { portfolio: { ...EMPTY_PORTFOLIO }, addresses: [] };
    }

    console.log(`[edgar-item2] ${reitName}: extracted Item 2, ${item2Text.length} chars`);

    const truncated = item2Text.slice(0, 30000);
    const anthropic = new Anthropic();

    // ── Step 1: Extract portfolio intelligence (always) ──────────────
    const portfolioRaw = await callClaude(
      anthropic,
      PORTFOLIO_PROMPT,
      `REIT: ${reitName}\n\n${truncated}`,
      4096
    );

    // Parse as JSON object (not array)
    const objMatch = portfolioRaw.match(/\{[\s\S]*\}/);
    let portfolio: PortfolioIntelligence = {
      ...EMPTY_PORTFOLIO,
      raw_item2_length: item2Text.length,
    };

    if (objMatch) {
      try {
        const parsed = JSON.parse(objMatch[0]);
        portfolio = {
          total_properties: parsed.total_properties ?? null,
          markets: Array.isArray(parsed.markets) ? parsed.markets : [],
          capex_annual_usd: parsed.capex_annual_usd ?? null,
          subsidiaries: Array.isArray(parsed.subsidiaries) ? parsed.subsidiaries : [],
          decision_makers: Array.isArray(parsed.decision_makers) ? parsed.decision_makers : [],
          filing_type: ["type_a", "type_b", "type_c"].includes(parsed.filing_type)
            ? parsed.filing_type
            : "type_c",
          raw_item2_length: item2Text.length,
        };
      } catch {
        console.log(`[edgar-item2] ${reitName}: failed to parse portfolio JSON`);
      }
    }

    console.log(
      `[edgar-item2] ${reitName}: portfolio — type=${portfolio.filing_type}, ` +
      `markets=${portfolio.markets.length}, total_props=${portfolio.total_properties}, ` +
      `decision_makers=${portfolio.decision_makers.length}, subs=${portfolio.subsidiaries.length}`
    );

    // ── Step 2: Type detection + address extraction (type_a only) ────
    // Strict classification: a real property list has 20+ addresses across
    // many states/cities AND a substantial Item 2 section.
    const addressMatches = item2Text.match(STREET_ADDRESS_RE) ?? [];
    const uniqueAddresses = new Set(
      addressMatches.map((a) => a.toLowerCase().trim())
    );

    // Extract distinct states (2-letter codes following city names near addresses)
    const stateRe = /,\s*([A-Z]{2})\s+\d{5}/g;
    const statesFound = new Set<string>();
    let sm;
    while ((sm = stateRe.exec(item2Text)) !== null) {
      statesFound.add(sm[1]);
    }

    // Extract distinct cities (word before state code)
    const cityRe = /([A-Z][a-zA-Z\s]{2,30}),\s*[A-Z]{2}\s+\d{5}/g;
    const citiesFound = new Set<string>();
    let cm;
    while ((cm = cityRe.exec(item2Text)) !== null) {
      citiesFound.add(cm[1].trim().toLowerCase());
    }

    const matchCount = uniqueAddresses.size;
    const stateCount = statesFound.size;
    const cityCount = citiesFound.size;
    const textLength = item2Text.length;

    // All three conditions must be true for type_a
    const isTypeA =
      matchCount >= 20 &&
      (stateCount >= 5 || cityCount >= 10) &&
      textLength > 5000;

    console.log(
      `[CLASSIFICATION] ${reitName}: ${matchCount} address patterns, ` +
      `${stateCount} states, ${cityCount} cities, ${textLength} chars → ` +
      `type_${isTypeA ? "a" : portfolio.filing_type === "type_c" ? "c" : "b"}`
    );

    // Override filing_type based on strict classification
    if (isTypeA) {
      portfolio.filing_type = "type_a";
    } else if (portfolio.filing_type === "type_a") {
      // Claude said type_a but regex disagrees — downgrade
      portfolio.filing_type = "type_b";
    }

    let addresses: TypeAAddress[] = [];

    if (isTypeA) {
      // Collect raw regex matches as hints for Claude
      const rawMatches = [...uniqueAddresses].slice(0, 10);
      const hintBlock = rawMatches.length > 0
        ? `\n\nThe following raw text patterns were found that appear to be addresses — use these as anchors to find all addresses:\n${rawMatches.join("\n")}\n\nNow extract all property addresses from this Item 2 text:`
        : "";

      // Use 15000 chars for type_a — large REITs need more context
      const typeATruncated = item2Text.slice(0, 15000);

      const addrResult = await callClaude(
        anthropic,
        ADDRESS_PROMPT,
        `REIT: ${reitName}${hintBlock}\n\n${typeATruncated}`,
        4096
      );

      const parsed = safeParseJsonArray(addrResult);
      addresses = parsed.map((p) => ({
        address: p.address != null ? String(p.address) : null,
        city: p.city != null ? String(p.city) : null,
        state: p.state != null ? String(p.state) : null,
        zip: p.zip != null ? String(p.zip) : null,
        property_type: String(p.property_type ?? "unknown"),
        sq_footage: p.sq_footage != null ? Number(p.sq_footage) : null,
        tenant: p.tenant != null ? String(p.tenant) : null,
        confidence_boost: Number(p.confidence_boost ?? 0),
      }));

      console.log(`[edgar-item2] ${reitName}: primary extraction returned ${addresses.length} addresses`);

      // Fallback: if 0 addresses but regex found them, try structured conversion
      if (addresses.length === 0 && rawMatches.length > 0) {
        console.log(`[edgar-item2] ${reitName}: fallback — converting ${rawMatches.length} raw regex matches`);

        // Grab surrounding context (200 chars around each match) for better parsing
        const contextSnippets = rawMatches.map((match) => {
          const idx = item2Text.toLowerCase().indexOf(match);
          if (idx === -1) return match;
          const start = Math.max(0, idx - 100);
          const end = Math.min(item2Text.length, idx + match.length + 200);
          return item2Text.slice(start, end).replace(/\s+/g, " ").trim();
        });

        const fallbackResult = await callClaude(
          anthropic,
          ADDRESS_PROMPT,
          `REIT: ${reitName}\n\nConvert these address snippets from a 10-K filing into structured JSON. Each snippet contains a property address with surrounding context:\n\n${contextSnippets.join("\n---\n")}`,
          4096
        );

        const fallbackParsed = safeParseJsonArray(fallbackResult);
        addresses = fallbackParsed.map((p) => ({
          address: p.address != null ? String(p.address) : null,
          city: p.city != null ? String(p.city) : null,
          state: p.state != null ? String(p.state) : null,
          zip: p.zip != null ? String(p.zip) : null,
          property_type: String(p.property_type ?? "unknown"),
          sq_footage: p.sq_footage != null ? Number(p.sq_footage) : null,
          tenant: p.tenant != null ? String(p.tenant) : null,
          confidence_boost: Number(p.confidence_boost ?? 0),
        }));

        console.log(`[edgar-item2] ${reitName}: fallback extracted ${addresses.length} addresses`);
      }
    }

    return { portfolio, addresses };
  } catch (err) {
    console.log(
      `[edgar-item2] ${reitName}: error — ${err instanceof Error ? err.message : err}`
    );
    return { portfolio: { ...EMPTY_PORTFOLIO }, addresses: [] };
  }
}
