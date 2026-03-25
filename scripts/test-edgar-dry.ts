// Test script: run EDGAR pipeline in dry-run mode
// Usage: npx tsx scripts/test-edgar-dry.ts [TICKER]
// Example: npx tsx scripts/test-edgar-dry.ts PLD

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { get10KDocumentUrl } from "../src/lib/intel/edgar-filing-fetcher";
import { extractItem2Properties } from "../src/lib/intel/edgar-item2-extractor";

const SEC_USER_AGENT = "Dilly/1.0 parks@sbdllc.co";

// Known REITs for quick testing (avoids needing admin client / getReitUniverse)
const KNOWN_REITS: Record<string, { cik: string; name: string }> = {
  PLD: { cik: "0001045609", name: "Prologis Inc" },
  PSA: { cik: "0001393311", name: "Public Storage" },
  ARE: { cik: "0001035002", name: "Alexandria Real Estate Equities Inc" },
  O: { cik: "0000726854", name: "Realty Income Corp" },
  EGP: { cik: "0000049600", name: "EastGroup Properties Inc" },
  SPG: { cik: "0001063761", name: "Simon Property Group Inc" },
  VICI: { cik: "0001695678", name: "VICI Properties Inc" },
};

const targetTicker = process.argv[2]?.toUpperCase();
const targets = targetTicker
  ? { [targetTicker]: KNOWN_REITS[targetTicker] }
  : KNOWN_REITS;

async function main() {
  const log: string[] = [];
  log.push("=== EDGAR Dry Run ===");
  log.push(`Targets: ${Object.keys(targets).join(", ")}`);

  let totalFound = 0;
  let totalSkipped = 0;

  for (const [ticker, reit] of Object.entries(targets)) {
    if (!reit) {
      log.push(`\n--- ${ticker}: UNKNOWN TICKER, skipping ---`);
      continue;
    }

    log.push(`\n--- ${ticker}: ${reit.name} (CIK ${reit.cik}) ---`);

    // Step 2: Find 10-K document URL
    const documentUrl = await get10KDocumentUrl(reit.cik, reit.name);
    if (!documentUrl) {
      log.push("  SKIPPED: no 10-K document found");
      continue;
    }
    log.push(`  10-K URL: ${documentUrl}`);

    // Step 3: Extract Item 2 properties
    const extraction = await extractItem2Properties(documentUrl, reit.name);
    const { properties, type_b } = extraction;
    log.push(
      `  Extracted: ${properties.length}${type_b ? " [TYPE B — market summaries]" : " [TYPE A — addresses]"}`
    );

    for (const prop of properties) {
      let score: number;
      if (prop.is_market_summary) {
        score = 30;
      } else {
        score = 20;
        if (prop.address) score += 15;
        if (prop.state) score += 10;
        if (prop.property_type !== "unknown") score += 10;
        if (prop.sq_footage) score += 10;
        score += Math.min(30, Math.max(0, prop.confidence_boost));
        score = Math.min(100, score);
      }

      totalFound++;

      if (score < 25) {
        totalSkipped++;
        continue;
      }

      if (prop.is_market_summary) {
        log.push(
          `  [TYPE B] ${prop.market_name}, ${prop.state} — ${prop.property_count ?? "?"} properties, ${prop.sq_footage ? (prop.sq_footage / 1_000_000).toFixed(1) + "M sqft" : "?"} (score=${score})`
        );
      } else {
        const parts = [
          prop.address,
          prop.city,
          prop.state,
          prop.zip,
          prop.property_type,
          prop.sq_footage
            ? `${prop.sq_footage.toLocaleString()} sqft`
            : null,
          prop.tenant ? `tenant: ${prop.tenant}` : null,
          `score=${score}`,
        ].filter(Boolean);
        log.push(`  [TYPE A] ${parts.join(" | ")}`);
      }
    }
  }

  log.push(
    `\n=== Summary: found=${totalFound} skipped=${totalSkipped} would_insert=${totalFound - totalSkipped} ===`
  );
  console.log(log.join("\n"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
