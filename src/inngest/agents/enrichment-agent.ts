import { inngest } from "../client";
import { createAdminClient } from "@/lib/supabase/admin";
import Anthropic from "@anthropic-ai/sdk";

const BATCH_SIZE = 50;
const WEBSITE_PATHS = ["/contact", "/about", "/team", "/staff", "/management"];

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Enrichment Agent ────────────────────────────────────────────────────────

export const enrichmentAgent = inngest.createFunction(
  {
    id: "enrichment-agent",
    retries: 1,
    triggers: [
      { event: "app/enrichment-agent.run" },
      { cron: "0 */6 * * *" }, // Every 6 hours
    ],
  },
  async ({ step }) => {
    const supabase = createAdminClient();

    let runId: string | null = null;
    let errorMessage: string | null = null;
    let processed = 0;
    let contactsFound = 0;
    let phonesFound = 0;
    let emailsFound = 0;
    const log: string[] = [];

    try {
      // ── Setup ─────────────────────────────────────────────────────────
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
            run_type: "enrichment",
            status: "running",
            started_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (runErr || !run) throw new Error("Failed to create agent_runs record");
        return run.id as string;
      });

      // ── Enrich ────────────────────────────────────────────────────────
      const result = await step.run("enrich-batch", async () => {
        const apiKey = process.env.GOOGLE_PLACES_API_KEY;
        const anthropicKey = process.env.ANTHROPIC_API_KEY;

        log.push(`Starting enrichment batch (limit ${BATCH_SIZE})`);
        log.push(`Google Places: ${apiKey ? "available" : "NOT SET"}`);
        log.push(`Anthropic: ${anthropicKey ? "available" : "NOT SET"}`);

        // Fetch pending records
        const { data: prospects } = await supabase
          .from("intel_prospects")
          .select("id,company_name,company_website,company_phone,address_line1,city,state,contact_first_name,contact_last_name,contact_title,contact_email,contact_phone,agent_metadata")
          .or("enrichment_status.is.null,enrichment_status.eq.pending")
          .gte("confidence_score", 30)
          .order("created_at", { ascending: false })
          .limit(BATCH_SIZE);

        if (!prospects || prospects.length === 0) {
          log.push("No records to enrich");
          return { processed: 0, contactsFound: 0, phonesFound: 0, emailsFound: 0, log };
        }

        log.push(`Found ${prospects.length} records to enrich`);

        const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;

        for (const prospect of prospects) {
          const name = prospect.company_name as string;
          const city = prospect.city as string | null;
          const state = prospect.state as string | null;
          let website = prospect.company_website as string | null;
          let phone = prospect.company_phone as string | null;
          let contactName: string | null = null;
          let contactTitle: string | null = null;
          let contactEmail: string | null = null;
          let contactPhone: string | null = null;

          try {
            // ── Step A: Google Places Details ──────────────────────────
            if (apiKey) {
              const placeId = (prospect.agent_metadata as Record<string, unknown>)?.place_id as string | undefined;

              if (placeId) {
                // Use Place Details API
                await delay(100);
                const detailResp = await fetch(
                  `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=website,formatted_phone_number,business_status&key=${apiKey}`
                );
                if (detailResp.ok) {
                  const detail = (await detailResp.json()) as {
                    result?: { website?: string; formatted_phone_number?: string };
                  };
                  if (detail.result?.website && !website) {
                    website = detail.result.website;
                  }
                  if (detail.result?.formatted_phone_number && !phone) {
                    phone = detail.result.formatted_phone_number;
                  }
                }
              } else {
                // Text Search to find the business
                await delay(100);
                const query = [name, city, state].filter(Boolean).join(" ");
                const searchResp = await fetch(
                  `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`
                );
                if (searchResp.ok) {
                  const searchData = (await searchResp.json()) as {
                    results?: { place_id?: string; name?: string }[];
                  };
                  const firstResult = searchData.results?.[0];
                  if (firstResult?.place_id) {
                    await delay(100);
                    const detailResp = await fetch(
                      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${firstResult.place_id}&fields=website,formatted_phone_number&key=${apiKey}`
                    );
                    if (detailResp.ok) {
                      const detail = (await detailResp.json()) as {
                        result?: { website?: string; formatted_phone_number?: string };
                      };
                      if (detail.result?.website && !website) {
                        website = detail.result.website;
                      }
                      if (detail.result?.formatted_phone_number && !phone) {
                        phone = detail.result.formatted_phone_number;
                      }
                    }
                  }
                }
              }

              if (website) log.push(`${name}: website=${website}`);
              if (phone) log.push(`${name}: phone=${phone}`);
            }

            // ── Step B: Website Contact Extraction ──────────────────────
            if (website && anthropic) {
              // Clean up the website URL
              let baseUrl = website;
              if (!baseUrl.startsWith("http")) baseUrl = "https://" + baseUrl;
              try {
                const url = new URL(baseUrl);
                baseUrl = url.origin;
              } catch {
                baseUrl = "";
              }

              if (baseUrl) {
                let foundContact = false;

                for (const path of WEBSITE_PATHS) {
                  if (foundContact) break;

                  try {
                    await delay(200);
                    const pageResp = await fetch(`${baseUrl}${path}`, {
                      headers: { "User-Agent": "Dilly/1.0 parks@sbdllc.co" },
                      signal: AbortSignal.timeout(5000),
                    });

                    if (!pageResp.ok) continue;

                    const contentType = pageResp.headers.get("content-type") ?? "";
                    if (!contentType.includes("text/html")) continue;

                    const html = await pageResp.text();
                    if (html.length < 200) continue;

                    // Truncate to 8000 chars to keep Claude costs low
                    const truncated = html
                      .replace(/<script[\s\S]*?<\/script>/gi, "")
                      .replace(/<style[\s\S]*?<\/style>/gi, "")
                      .replace(/<[^>]+>/g, " ")
                      .replace(/\s+/g, " ")
                      .trim()
                      .slice(0, 8000);

                    if (truncated.length < 100) continue;

                    const claudeResp = await anthropic.messages.create({
                      model: "claude-sonnet-4-5-20250514",
                      max_tokens: 500,
                      system: "You extract contact information from company websites. Return ONLY valid JSON or null.",
                      messages: [
                        {
                          role: "user",
                          content: `From this company page for "${name}", find the person most likely responsible for facilities, property management, building maintenance, or commercial roofing decisions. Look for titles like: Facilities Manager, Property Manager, VP Operations, Director of Maintenance, Building Engineer, Asset Manager.\n\nReturn JSON: { "name": "Full Name", "title": "Their Title", "email": "email@example.com", "phone": "555-123-4567" }\nReturn null if no relevant contact found.\n\nPage content:\n${truncated}`,
                        },
                      ],
                    });

                    const text = claudeResp.content
                      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
                      .map((b) => b.text)
                      .join("");

                    if (text.trim() === "null" || text.trim() === "") continue;

                    try {
                      const match = text.match(/\{[\s\S]*\}/);
                      if (match) {
                        const parsed = JSON.parse(match[0]);
                        if (parsed.name) {
                          contactName = String(parsed.name);
                          contactTitle = parsed.title ? String(parsed.title) : null;
                          contactEmail = parsed.email ? String(parsed.email) : null;
                          contactPhone = parsed.phone ? String(parsed.phone) : null;
                          foundContact = true;
                          log.push(`${name}: contact found — ${contactName} (${contactTitle ?? "no title"})`);
                        }
                      }
                    } catch {
                      // JSON parse failed — continue to next path
                    }
                  } catch {
                    // Fetch failed for this path — continue
                  }
                }
              }
            }

            // ── Step C: Update intel_prospects ──────────────────────────
            const updates: Record<string, unknown> = {
              enrichment_status: "completed",
            };

            if (website && !prospect.company_website) {
              updates.company_website = website;
            }
            if (phone && !prospect.company_phone) {
              updates.company_phone = phone;
              phonesFound++;
            }

            if (contactName) {
              const nameParts = contactName.split(/\s+/);
              if (!prospect.contact_first_name) {
                updates.contact_first_name = nameParts[0] || null;
              }
              if (!prospect.contact_last_name) {
                updates.contact_last_name = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;
              }
              if (contactTitle && !prospect.contact_title) {
                updates.contact_title = contactTitle;
              }
              if (contactEmail && !prospect.contact_email) {
                updates.contact_email = contactEmail;
                emailsFound++;
              }
              if (contactPhone && !prospect.contact_phone) {
                updates.contact_phone = contactPhone;
              }
              contactsFound++;
            }

            // Boost confidence score by 10 for enriched records
            if (website || phone || contactName) {
              const { data: current } = await supabase
                .from("intel_prospects")
                .select("confidence_score")
                .eq("id", prospect.id)
                .single();
              const currentScore = (current?.confidence_score as number) ?? 25;
              updates.confidence_score = Math.min(100, currentScore + 10);
            }

            await supabase
              .from("intel_prospects")
              .update(updates)
              .eq("id", prospect.id);

            processed++;
          } catch (err) {
            log.push(`${name}: ERROR — ${err instanceof Error ? err.message : err}`);
            // Mark as failed so we don't retry endlessly
            await supabase
              .from("intel_prospects")
              .update({ enrichment_status: "failed" })
              .eq("id", prospect.id);
          }
        }

        log.push(`Done: processed=${processed} contacts=${contactsFound} phones=${phonesFound} emails=${emailsFound}`);
        return { processed, contactsFound, phonesFound, emailsFound, log };
      });

      processed = result.processed;
      contactsFound = result.contactsFound;
      phonesFound = result.phonesFound;
      emailsFound = result.emailsFound;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      log.push(`FATAL: ${errorMessage}`);
    } finally {
      if (runId) {
        await step.run("finalize", async () => {
          await supabase
            .from("agent_runs")
            .update({
              status: errorMessage ? "failed" : "completed",
              prospects_found: processed,
              prospects_added: contactsFound,
              prospects_skipped_dedup: 0,
              source_breakdown: {
                enrichment: {
                  found: processed,
                  added: contactsFound,
                  skipped: 0,
                  debug: log,
                  phones_found: phonesFound,
                  emails_found: emailsFound,
                },
              },
              completed_at: new Date().toISOString(),
              error_message: errorMessage,
            })
            .eq("id", runId);

          // Update agent_registry
          await supabase
            .from("agent_registry")
            .update({
              last_run_at: new Date().toISOString(),
            })
            .eq("agent_name", "enrichment");
        });
      }
    }
  }
);
