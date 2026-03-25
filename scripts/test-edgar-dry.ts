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

    // Step 3: Extract portfolio intelligence
    const { portfolio, addresses } = await extractItem2Properties(documentUrl, reit.name);
    log.push(
      `  Portfolio: type=${portfolio.filing_type}, markets=${portfolio.markets.length}, ` +
      `total_props=${portfolio.total_properties ?? "?"}, contacts=${portfolio.decision_makers.length}, ` +
      `subs=${portfolio.subsidiaries.length}`
    );

    // Show markets
    for (const m of portfolio.markets.slice(0, 5)) {
      const sqft = m.sq_footage_sf ? `${(m.sq_footage_sf / 1_000_000).toFixed(1)}M sqft` : "?";
      log.push(`    Market: ${m.name}, ${m.state ?? "?"} — ${m.property_count ?? "?"} props, ${sqft}`);
    }
    if (portfolio.markets.length > 5) log.push(`    ... and ${portfolio.markets.length - 5} more`);

    // Show decision makers
    for (const dm of portfolio.decision_makers) {
      log.push(`    Contact: ${dm.name} — ${dm.title} (${dm.contact_type})`);
    }

    // Type A addresses (these would go to intel_prospects)
    if (addresses.length > 0) {
      log.push(`  Type A Addresses (${addresses.length}):`);
      for (const addr of addresses) {
        let score = 20;
        if (addr.address) score += 15;
        if (addr.state) score += 10;
        if (addr.property_type !== "unknown") score += 10;
        if (addr.sq_footage) score += 10;
        score += Math.min(30, Math.max(0, addr.confidence_boost));
        score = Math.min(100, score);

        totalFound++;
        if (score < 25) { totalSkipped++; continue; }

        const parts = [
          addr.address, addr.city, addr.state, addr.zip,
          addr.property_type,
          addr.sq_footage ? `${addr.sq_footage.toLocaleString()} sqft` : null,
          addr.tenant ? `tenant: ${addr.tenant}` : null,
          `score=${score}`,
        ].filter(Boolean);
        log.push(`    ${parts.join(" | ")}`);
      }
    } else {
      log.push(`  No individual addresses (${portfolio.filing_type}) — portfolio stored on entity only`);
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
