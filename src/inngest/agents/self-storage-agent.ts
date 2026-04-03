import { inngest } from "../client";
import { createAdminClient } from "@/lib/supabase/admin";

export const selfStorageAgent = inngest.createFunction(
  {
    id: "self-storage-agent",
    retries: 1,
    triggers: [
      { event: "app/self-storage-agent.run" },
      { cron: "0 9 3 * *" },
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
            run_type: "self-storage-agent",
            status: "running",
            started_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (runErr || !run) throw new Error("Failed to create agent_runs record");
        return run.id as string;
      });

      await step.run("discover", async () => {
        console.log("[self-storage-agent] Not yet implemented");
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
              source_breakdown: { "self-storage-agent": { found: 0, added: 0, skipped: 0, message: "Not yet implemented" } },
              completed_at: new Date().toISOString(),
              error_message: errorMessage,
            })
            .eq("id", runId);
        });
      }
    }
  }
);
