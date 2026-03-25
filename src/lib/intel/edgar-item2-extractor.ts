// Step 3: Fetch a 10-K document, extract Item 2 Properties, parse with Claude

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
};

const SYSTEM_PROMPT =
  "You are extracting commercial property data from a REIT 10-K filing Item 2 section. " +
  "Extract every property or location mentioned. Return ONLY a valid JSON array, no explanation, no markdown. " +
  "Each object: { address: string|null, city: string|null, state: string|null, zip: string|null, " +
  "property_type: 'office'|'industrial'|'retail'|'multifamily'|'healthcare'|'self_storage'|'mixed'|'unknown', " +
  "sq_footage: number|null, tenant: string|null, confidence_boost: number 0-30 }";

export async function extractItem2Properties(
  documentUrl: string,
  reitName: string
): Promise<RawProperty[]> {
  try {
    // Fetch the 10-K HTML document
    await new Promise((r) => setTimeout(r, 200));
    const resp = await fetch(documentUrl, {
      headers: { "User-Agent": SEC_USER_AGENT },
    });

    if (!resp.ok) {
      console.log(`[edgar-item2] ${reitName}: document fetch failed ${resp.status}`);
      return [];
    }

    const html = await resp.text();

    // Strip HTML tags to get plain text for regex matching
    const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ");

    // Find ALL Item 2 matches, then for each find the next Item 3.
    // Pick the pair that produces the longest section (skips TOC entries).
    const item2Regex = /item\s+2\.?\s*properties/gi;
    let item2Match: RegExpExecArray | null = null;
    let bestStart = -1;
    let bestEnd = -1;

    while ((item2Match = item2Regex.exec(text)) !== null) {
      const afterIdx = item2Match.index + item2Match[0].length;
      const item3Match = text.slice(afterIdx).match(/item\s+3\.?\s*legal\s+proceedings/i);
      if (!item3Match || item3Match.index === undefined) continue;

      const sectionLen = item3Match.index;
      if (sectionLen > (bestEnd - bestStart)) {
        bestStart = item2Match.index;
        bestEnd = afterIdx + item3Match.index;
      }
    }

    if (bestStart === -1) {
      console.log(`[edgar-item2] ${reitName}: no valid Item 2 → Item 3 section found`);
      return [];
    }

    const item2Text = text.slice(bestStart, bestEnd).trim();

    if (item2Text.length < 200) {
      console.log(`[edgar-item2] ${reitName}: Item 2 too short (${item2Text.length} chars), likely a reference`);
      return [];
    }

    console.log(`[edgar-item2] ${reitName}: extracted Item 2, ${item2Text.length} chars`);

    // Truncate to 30000 chars for Claude — properties can be deep in the text
    const truncated = item2Text.slice(0, 30000);

    const anthropic = new Anthropic();

    const result = await callClaude(
      anthropic,
      SYSTEM_PROMPT,
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
    }));

    console.log(`[edgar-item2] ${reitName}: Claude returned ${properties.length} properties`);
    return properties;
  } catch (err) {
    console.log(`[edgar-item2] ${reitName}: error — ${err instanceof Error ? err.message : err}`);
    return [];
  }
}
