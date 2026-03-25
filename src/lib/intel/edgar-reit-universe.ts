// Step 1: Build and cache the REIT universe from SEC EDGAR
// Uses name-based filtering + SIC code confirmation.
// Results cached in intel_entities table to avoid re-fetching.

import { createAdminClient } from "@/lib/supabase/admin";

const SEC_USER_AGENT = "Dilly/1.0 parks@sbdllc.co";

const REIT_SIC_CODES = new Set(["6798", "6552", "6512", "6726"]);

const NAME_KEYWORDS =
  /realty|reit|property|properties|real estate|trust|equity|industrial|office|storage|apartments|residential|commercial/i;

export type ReitEntity = {
  cik: string;
  ticker: string;
  name: string;
};

async function secFetch(url: string): Promise<Response> {
  await new Promise((r) => setTimeout(r, 100));
  return fetch(url, { headers: { "User-Agent": SEC_USER_AGENT } });
}

export async function getReitUniverse(
  forceRefresh = false
): Promise<ReitEntity[]> {
  const supabase = createAdminClient();

  // Check cache first
  if (!forceRefresh) {
    const { data: cached } = await supabase
      .from("intel_entities")
      .select("cik,ticker,name")
      .eq("entity_type", "reit")
      .eq("enabled", true)
      .not("sic", "is", null);

    if (cached && cached.length > 0) {
      console.log(
        `[reit-universe] Returning ${cached.length} cached REITs from intel_entities`
      );
      return cached.map((r) => ({
        cik: String(r.cik).padStart(10, "0"),
        ticker: String(r.ticker ?? ""),
        name: String(r.name),
      }));
    }
  }

  console.log("[reit-universe] Fetching fresh REIT universe from SEC...");

  // Fetch all company tickers
  const resp = await secFetch(
    "https://www.sec.gov/files/company_tickers_exchange.json"
  );

  if (!resp.ok) {
    throw new Error(
      `SEC tickers fetch failed: ${resp.status} ${resp.statusText}`
    );
  }

  const data = (await resp.json()) as {
    data: [number, string, string, string][];
    fields: string[];
  };

  const cikIdx = data.fields.indexOf("cik");
  const nameIdx = data.fields.indexOf("name");
  const tickerIdx = data.fields.indexOf("ticker");
  const exchangeIdx = data.fields.indexOf("exchange");

  // Filter by name keywords to narrow the candidate pool
  const candidates: {
    cik: string;
    ticker: string;
    name: string;
    exchange: string;
  }[] = [];

  for (const row of data.data) {
    const name = String(row[nameIdx] ?? "");
    if (!NAME_KEYWORDS.test(name)) continue;

    candidates.push({
      cik: String(row[cikIdx]).padStart(10, "0"),
      ticker: String(row[tickerIdx] ?? "").toUpperCase(),
      name,
      exchange: String(row[exchangeIdx] ?? ""),
    });
  }

  console.log(
    `[reit-universe] ${data.data.length} total companies → ${candidates.length} name-keyword candidates`
  );

  // Confirm SIC codes by fetching submissions for each candidate
  const confirmed: ReitEntity[] = [];
  let checked = 0;
  let errors = 0;

  for (const candidate of candidates) {
    try {
      const submResp = await secFetch(
        `https://data.sec.gov/submissions/CIK${candidate.cik}.json`
      );

      if (!submResp.ok) {
        errors++;
        continue;
      }

      const sub = (await submResp.json()) as { sic?: string };
      const sic = String(sub.sic ?? "");

      checked++;
      if (checked % 50 === 0) {
        console.log(
          `[reit-universe] Checked ${checked}/${candidates.length}, confirmed ${confirmed.length} REITs so far`
        );
      }

      if (!REIT_SIC_CODES.has(sic)) continue;

      // Upsert into intel_entities
      await supabase.from("intel_entities").upsert(
        {
          cik: candidate.cik,
          name: candidate.name,
          ticker: candidate.ticker,
          sic,
          exchange: candidate.exchange,
          entity_type: "reit",
          enabled: true,
        },
        { onConflict: "cik" }
      );

      confirmed.push({
        cik: candidate.cik,
        ticker: candidate.ticker,
        name: candidate.name,
      });
    } catch {
      errors++;
    }
  }

  console.log(
    `[reit-universe] Done: ${checked} checked, ${confirmed.length} confirmed REITs, ${errors} errors`
  );

  return confirmed;
}
