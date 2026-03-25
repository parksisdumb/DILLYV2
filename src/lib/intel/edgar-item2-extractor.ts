// Step 3: Fetch a 10-K document, extract Item 2 Properties, parse with Claude
// Detects Type A (individual addresses) vs Type B (market-level summaries)

import Anthropic from "@anthropic-ai/sdk";
import { safeParseJsonArray, callClaude } from "@/lib/intel/utils";

const SEC_USER_AGENT = "Dilly/1.0 parks@sbdllc.co";

export type RawProperty = {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  property_type: string;
  sq_footage: number | null;
  tenant: string | null;
  confidence_boost: number;
  is_market_summary: boolean;
  market_name: string | null;
  property_count: number | null;
};

export type ExtractionResult = {
  properties: RawProperty[];
  type_b: boolean;
};

// Type A: individual property addresses
const TYPE_A_PROMPT =
  "You are extracting commercial property data from a REIT 10-K filing Item 2 section. " +
  "Extract every property or location mentioned. Return ONLY a valid JSON array, no explanation, no markdown. " +
  "Each object: { address: string|null, city: string|null, state: string|null, zip: string|null, " +
  "property_type: 'office'|'industrial'|'retail'|'multifamily'|'healthcare'|'self_storage'|'mixed'|'unknown', " +
  "sq_footage: number|null, tenant: string|null, confidence_boost: number 0-30 }";

// Type B: market-level summaries
const TYPE_B_PROMPT =
  "This REIT lists properties by market/region, not individual addresses. " +
  "Extract each market entry as a record. Return ONLY a valid JSON array, no explanation, no markdown. " +
  "Each object: { market_name: string, state: string|null, property_count: number|null, " +
  "sq_footage: number|null, property_type: 'office'|'industrial'|'retail'|'multifamily'|'healthcare'|'self_storage'|'mixed'|'unknown', " +
  "confidence_boost: 5 }";

// Regex for street address patterns
const STREET_ADDRESS_RE =
  /\d+\s+[A-Za-z]+\s+(St|Ave|Blvd|Dr|Rd|Way|Ln|Pkwy|Hwy|Road|Street|Avenue|Boulevard|Drive|Lane|Parkway|Highway|Circle|Court|Place|Square|Trail)/gi;

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
      return { properties: [], type_b: false };
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
      console.log(
        `[edgar-item2] ${reitName}: no valid Item 2 → Item 3 section found`
      );
      return { properties: [], type_b: false };
    }

    const item2Text = text.slice(bestStart, bestEnd).trim();

    if (item2Text.length < 200) {
      console.log(
        `[edgar-item2] ${reitName}: Item 2 too short (${item2Text.length} chars), likely a reference`
      );
      return { properties: [], type_b: false };
    }

    console.log(
      `[edgar-item2] ${reitName}: extracted Item 2, ${item2Text.length} chars`
    );

    // ── Type detection ─────────────────────────────────────────────────
    const addressMatches = item2Text.match(STREET_ADDRESS_RE) ?? [];
    const uniqueAddresses = new Set(
      addressMatches.map((a) => a.toLowerCase().trim())
    );
    const isTypeB = uniqueAddresses.size < 3;

    console.log(
      `[edgar-item2] ${reitName}: detected ${uniqueAddresses.size} distinct street addresses → ${isTypeB ? "TYPE B (market)" : "TYPE A (address)"}`
    );

    const truncated = item2Text.slice(0, 30000);
    const anthropic = new Anthropic();

    if (isTypeB) {
      // ── Type B: market-level extraction ─────────────────────────────
      const result = await callClaude(
        anthropic,
        TYPE_B_PROMPT,
        `REIT: ${reitName}\n\n${truncated}`,
        4096
      );

      const parsed = safeParseJsonArray(result);

      const properties: RawProperty[] = parsed.map((p) => ({
        address: null,
        city: p.market_name != null ? String(p.market_name) : null,
        state: p.state != null ? String(p.state) : null,
        zip: null,
        property_type: String(p.property_type ?? "unknown"),
        sq_footage: p.sq_footage != null ? Number(p.sq_footage) : null,
        tenant: null,
        confidence_boost: 5,
        is_market_summary: true,
        market_name: p.market_name != null ? String(p.market_name) : null,
        property_count: p.property_count != null ? Number(p.property_count) : null,
      }));

      console.log(
        `[edgar-item2] [TYPE B] ${reitName} — market-level REIT, extracted ${properties.length} market summaries`
      );
      return { properties, type_b: true };
    }

    // ── Type A: individual address extraction ─────────────────────────
    const result = await callClaude(
      anthropic,
      TYPE_A_PROMPT,
      `REIT: ${reitName}\n\n${truncated}`,
      4096
    );

    const parsed = safeParseJsonArray(result);

    const properties: RawProperty[] = parsed.map((p) => ({
      address: p.address != null ? String(p.address) : null,
      city: p.city != null ? String(p.city) : null,
      state: p.state != null ? String(p.state) : null,
      zip: p.zip != null ? String(p.zip) : null,
      property_type: String(p.property_type ?? "unknown"),
      sq_footage: p.sq_footage != null ? Number(p.sq_footage) : null,
      tenant: p.tenant != null ? String(p.tenant) : null,
      confidence_boost: Number(p.confidence_boost ?? 0),
      is_market_summary: false,
      market_name: null,
      property_count: null,
    }));

    console.log(
      `[edgar-item2] ${reitName}: Claude returned ${properties.length} properties`
    );
    return { properties, type_b: false };
  } catch (err) {
    console.log(
      `[edgar-item2] ${reitName}: error — ${err instanceof Error ? err.message : err}`
    );
    return { properties: [], type_b: false };
  }
}
