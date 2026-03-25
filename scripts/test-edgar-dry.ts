// Test script: run EDGAR pipeline in dry-run mode against 5 REITs
// Usage: npx tsx scripts/test-edgar-dry.ts

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getReitUniverse } from "../src/lib/intel/edgar-reit-universe";
import { get10KDocumentUrl } from "../src/lib/intel/edgar-filing-fetcher";
import { extractItem2Properties } from "../src/lib/intel/edgar-item2-extractor";

const TARGET_TICKERS = new Set(["PSA", "EGP", "ARE", "PLD", "O"]);

async function main() {
  const log: string[] = [];

  log.push("=== EDGAR Dry Run ===");
  log.push(`Target tickers: ${[...TARGET_TICKERS].join(", ")}`);

  // Step 1: Get REIT universe
  const allReits = await getReitUniverse();
  log.push(`getReitUniverse returned ${allReits.length} total REITs`);

  const reits = allReits.filter((r) => TARGET_TICKERS.has(r.ticker));
  log.push(`Filtered to ${reits.length} target REITs: ${reits.map((r) => `${r.ticker} (${r.name}, CIK ${r.cik})`).join(", ")}`);

  let totalFound = 0;
  let totalSkipped = 0;

  for (const reit of reits) {
    log.push(`\n--- ${reit.ticker}: ${reit.name} (CIK ${reit.cik}) ---`);

    // Step 2: Find 10-K document URL
    const documentUrl = await get10KDocumentUrl(reit.cik, reit.name);

    if (!documentUrl) {
      log.push(`  SKIPPED: no 10-K document found`);
      continue;
    }

    log.push(`  10-K URL: ${documentUrl}`);

    // Step 3: Extract Item 2 properties
    const properties = await extractItem2Properties(documentUrl, reit.name);
    log.push(`  Properties extracted: ${properties.length}`);

    for (const prop of properties) {
      let score = 20;
      if (prop.address) score += 15;
      if (prop.state) score += 10;
      if (prop.property_type !== "unknown") score += 10;
      if (prop.sq_footage) score += 10;
      score += Math.min(30, Math.max(0, prop.confidence_boost));
      score = Math.min(100, score);

      totalFound++;

      if (score < 25) {
        totalSkipped++;
        continue;
      }

      const parts = [
        prop.address,
        prop.city,
        prop.state,
        prop.zip,
        prop.property_type,
        prop.sq_footage ? `${prop.sq_footage.toLocaleString()} sqft` : null,
        prop.tenant ? `tenant: ${prop.tenant}` : null,
        `score=${score}`,
      ].filter(Boolean);

      log.push(`  [DRY RUN] ${parts.join(" | ")}`);
    }
  }

  log.push(`\n=== Summary: found=${totalFound} skipped_below_25=${totalSkipped} would_insert=${totalFound - totalSkipped} ===`);

  // Print all at once
  console.log(log.join("\n"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
