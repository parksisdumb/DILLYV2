import { inngest } from "../client";
import { createAdminClient } from "@/lib/supabase/admin";

export const publicBidAgent = inngest.createFunction(
  {
    id: "public-bid-agent",
    retries: 1,
    triggers: [
      { event: "app/public-bid-agent.run" },
      { cron: "0 10 * * 1" },
    ],
  },
  async ({ step }) => {
    const supabase = createAdminClient();

    let runId: string | null = null;
    let errorMessage: string | null = null;

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
            run_type: "public-bid-agent",
            status: "running",
            started_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (runErr || !run) throw new Error("Failed to create agent_runs record");
        return run.id as string;
      });

      await step.run("discover", async () => {
        console.log("[public-bid-agent] Not yet implemented");
        return { found: 0, added: 0, skipped: 0, message: "Not yet implemented" };
      });
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      if (runId) {
        await step.run("finalize", async () => {
          await supabase
            .from("agent_runs")
            .update({
              status: errorMessage ? "failed" : "completed",
              prospects_found: 0,
              prospects_added: 0,
              prospects_skipped_dedup: 0,
              source_breakdown: { "public-bid-agent": { found: 0, added: 0, skipped: 0, message: "Not yet implemented" } },
              completed_at: new Date().toISOString(),
              error_message: errorMessage,
            })
            .eq("id", runId);
        });
      }
    }
  }
);
