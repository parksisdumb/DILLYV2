import { inngest } from "../client";
import { createAdminClient } from "@/lib/supabase/admin";
import { getReitUniverse } from "@/lib/intel/edgar-reit-universe";
import { get10KDocumentUrl } from "@/lib/intel/edgar-filing-fetcher";
import { extractItem2Properties } from "@/lib/intel/edgar-item2-extractor";

// ── Types ────────────────────────────────────────────────────────────────────

type SourceResult = {
  found: number;
  added: number;
  skipped: number;
  debug?: string[];
};

// ── Insert helper (for type_a addresses only) ────────────────────────────────

const MAX_INSERTS_PER_RUN = 500;
let insertCount = 0;

function isCapReached(): boolean {
  return insertCount >= MAX_INSERTS_PER_RUN;
}

async function insertIntelProspect(
  supabase: ReturnType<typeof createAdminClient>,
  prospect: Record<string, unknown>
): Promise<"added" | "skipped" | "error"> {
  if (isCapReached()) return "skipped";
  const { error } = await supabase.from("intel_prospects").insert(prospect);
  if (!error) {
    insertCount++;
    return "added";
  }
  if (error.code === "23505" || error.message?.includes("unique")) return "skipped";
  console.error("[edgar] insert error:", error.message);
  return "error";
}

// ── EDGAR Source ─────────────────────────────────────────────────────────────

const EDGAR_BATCH_SIZE = 50;

async function sourceEdgar(
  supabase: ReturnType<typeof createAdminClient>,
  agentRunId: string
): Promise<SourceResult> {
  const result: SourceResult = { found: 0, added: 0, skipped: 0 };
  const log: string[] = [];

  try {
    log.push("Starting EDGAR intelligence pipeline");

    const { data: registry } = await supabase
      .from("agent_registry")
      .select("config")
      .eq("agent_name", "edgar_10k")
      .single();

    const config = (registry?.config as Record<string, unknown>) ?? {};
    const lastProcessedCik = (config.last_processed_cik as string) ?? null;
    const universeRefreshedAt = config.universe_refreshed_at as string | null;

    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const needsRefresh =
      !universeRefreshedAt ||
      Date.now() - new Date(universeRefreshedAt).getTime() > thirtyDaysMs;

    log.push(
      `Config: lastCik=${lastProcessedCik ?? "none"}, refresh=${needsRefresh}`
    );

    const reits = await getReitUniverse(needsRefresh);
    log.push(`Universe: ${reits.length} REITs`);

    if (reits.length === 0) {
      log.push("No REITs found, stopping");
      return { ...result, debug: log };
    }

    if (needsRefresh) {
      await supabase
        .from("agent_registry")
        .update({
          config: { ...config, universe_refreshed_at: new Date().toISOString() },
        })
        .eq("agent_name", "edgar_10k");
    }

    // Pick batch — round-robin from last processed CIK
    let startIdx = 0;
    if (lastProcessedCik) {
      const lastIdx = reits.findIndex((r) => r.cik === lastProcessedCik);
      if (lastIdx !== -1) startIdx = lastIdx + 1;
      if (startIdx >= reits.length) startIdx = 0;
    }

    const batch = reits.slice(startIdx, startIdx + EDGAR_BATCH_SIZE);
    const wrapCount = Math.max(0, EDGAR_BATCH_SIZE - batch.length);
    if (wrapCount > 0 && startIdx > 0) {
      batch.push(...reits.slice(0, Math.min(wrapCount, startIdx)));
    }

    log.push(
      `Batch: ${batch.length} REITs starting at ${startIdx} (${batch[0]?.name} → ${batch[batch.length - 1]?.name})`
    );

    let lastCikProcessed = lastProcessedCik;

    for (const reit of batch) {
      if (isCapReached()) {
        log.push("Insert cap reached, stopping");
        break;
      }

      lastCikProcessed = reit.cik;
      log.push(`Processing ${reit.name} (${reit.ticker}, CIK ${reit.cik})`);

      const documentUrl = await get10KDocumentUrl(reit.cik, reit.name);
      if (!documentUrl) {
        log.push(`SKIPPED: ${reit.name} — no 10-K found`);
        continue;
      }

      log.push(`Document: ${documentUrl}`);
      const { portfolio, addresses } = await extractItem2Properties(
        documentUrl,
        reit.name
      );

      log.push(
        `${reit.name}: ${portfolio.filing_type}, ${portfolio.markets.length} markets, ` +
          `${portfolio.total_properties ?? "?"} props, ${portfolio.decision_makers.length} contacts, ` +
          `${addresses.length} addresses`
      );

      // Store portfolio on intel_entities
      const { data: entityRow } = await supabase
        .from("intel_entities")
        .select("id")
        .eq("cik", reit.cik)
        .maybeSingle();

      const entityId = entityRow?.id as string | null;

      if (entityId) {
        await supabase
          .from("intel_entities")
          .update({ portfolio_summary: portfolio })
          .eq("id", entityId);
        log.push(`Updated portfolio_summary for ${reit.name}`);
      }

      // Store decision_makers in intel_contacts
      for (const dm of portfolio.decision_makers) {
        if (!dm.name || !entityId) continue;
        const nameParts = dm.name.split(/\s+/);
        await supabase.from("intel_contacts").insert({
          intel_entity_id: entityId,
          first_name: nameParts[0] || null,
          last_name:
            nameParts.length > 1 ? nameParts.slice(1).join(" ") : null,
          full_name: dm.name,
          title: dm.title || null,
          contact_type: dm.contact_type || "executive",
          source_detail: "edgar_10k",
          agent_metadata: { cik: reit.cik, ticker: reit.ticker },
        });
      }
      if (portfolio.decision_makers.length > 0) {
        log.push(
          `Inserted ${portfolio.decision_makers.length} contacts for ${reit.name}`
        );
      }

      // Type A only: insert addresses into intel_prospects
      if (portfolio.filing_type === "type_a" && addresses.length > 0) {
        for (const addr of addresses) {
          if (isCapReached()) break;

          let score = 20;
          if (addr.address) score += 15;
          if (addr.state) score += 10;
          if (addr.property_type !== "unknown") score += 10;
          if (addr.sq_footage) score += 10;
          score += Math.min(30, Math.max(0, addr.confidence_boost));
          score = Math.min(100, score);

          result.found++;
          if (score < 25) {
            result.skipped++;
            continue;
          }

          const status = await insertIntelProspect(supabase, {
            company_name: reit.name,
            domain_normalized: null,
            address_line1: addr.address || null,
            city: addr.city || null,
            state: addr.state || null,
            postal_code: addr.zip || null,
            building_type: addr.property_type || null,
            building_sq_footage: addr.sq_footage || null,
            account_type: "owner",
            vertical: "commercial_real_estate",
            owner_name_legal: reit.name,
            entity_id: entityId,
            confidence_score: score,
            source: "agent",
            source_detail: "edgar_10k_address",
            agent_run_id: agentRunId,
            agent_metadata: {
              cik: reit.cik,
              ticker: reit.ticker,
              tenant: addr.tenant,
            },
          });

          if (status === "added") result.added++;
          else if (status === "skipped") result.skipped++;
        }
      } else if (portfolio.filing_type !== "type_a") {
        log.push(
          `${reit.name}: ${portfolio.filing_type} — entity updated, no addresses for intel_prospects`
        );
      }
    }

    // Save progress
    if (lastCikProcessed) {
      await supabase
        .from("agent_registry")
        .update({
          config: {
            ...config,
            last_processed_cik: lastCikProcessed,
            universe_refreshed_at:
              config.universe_refreshed_at ?? new Date().toISOString(),
          },
          last_run_at: new Date().toISOString(),
          total_found: result.found,
          total_inserted: result.added,
        })
        .eq("agent_name", "edgar_10k");

      log.push(`Progress saved: last_processed_cik=${lastCikProcessed}`);
    }

    log.push(
      `Done: found=${result.found} added=${result.added} skipped=${result.skipped}`
    );
    return { ...result, debug: log };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.push(`FATAL: ${msg}`);
    return { ...result, debug: log };
  }
}

// ── Inngest Function ─────────────────────────────────────────────────────────

export const edgarIntelligenceAgent = inngest.createFunction(
  {
    id: "edgar-intelligence-agent",
    retries: 1,
    triggers: [
      { event: "app/edgar-intelligence.run" },
      { cron: "0 2 1 * *" }, // Monthly, 1st at 2am UTC
    ],
  },
  async ({ step }) => {
    const supabase = createAdminClient();
    insertCount = 0;

    let runId: string | null = null;
    let errorMessage: string | null = null;
    let edgarResult: SourceResult = { found: 0, added: 0, skipped: 0 };

    try {
      runId = await step.run("setup", async () => {
        const { data: firstOrg } = await supabase
          .from("orgs")
          .select("id")
          .limit(1)
          .single();

        const { data: run, error: runErr } = await supabase
          .from("agent_runs")
          .insert({
            org_id: firstOrg?.id,
            run_type: "edgar_intelligence",
            status: "running",
            started_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (runErr || !run) throw new Error("Failed to create agent_runs record");
        return run.id as string;
      });

      const er = await step.run("source-edgar", async () => {
        return sourceEdgar(supabase, runId!);
      });
      edgarResult = er;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      if (runId) {
        await step.run("finalize", async () => {
          await supabase
            .from("agent_runs")
            .update({
              status: errorMessage ? "failed" : "completed",
              prospects_found: edgarResult.found,
              prospects_added: edgarResult.added,
              prospects_skipped_dedup: edgarResult.skipped,
              source_breakdown: { edgar_10k: edgarResult },
              completed_at: new Date().toISOString(),
              error_message: errorMessage,
            })
            .eq("id", runId);
        });
      }
    }
  }
);
