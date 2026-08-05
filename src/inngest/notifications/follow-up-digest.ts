import { inngest } from "../client";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDigestCron } from "@/lib/notifications/run";
import { digestCronEnabled } from "@/lib/notifications/send";

// Follow-up morning digest — 7:00 AM America/Chicago, daily. The push layer over
// the pull-based Advance queue.
//
// Armed by default. FOLLOW_UP_DIGEST_ENABLED=false is the kill switch (disable the
// blast without a redeploy). `app/follow-up-digest.run` triggers a run on demand
// from the Inngest dashboard for debugging.
export const followUpDigestScheduler = inngest.createFunction(
  {
    id: "follow-up-digest",
    retries: 1,
    triggers: [{ cron: "TZ=America/Chicago 0 7 * * *" }, { event: "app/follow-up-digest.run" }],
  },
  async ({ step }) => {
    if (!digestCronEnabled()) {
      // Kill switch engaged — not a failure, the run simply didn't arm.
      console.warn("[follow-up-digest] skipped: disabled via FOLLOW_UP_DIGEST_ENABLED");
      return { skipped: "disabled" };
    }

    // One atomic step. Idempotency (digest_sends unique claim) makes a retry safe:
    // already-sent users are skipped, so no double-send on re-run.
    return await step.run("send-digests", async () => {
      const admin = createAdminClient();
      try {
        const summary = await runDigestCron(admin);
        console.log("[follow-up-digest] done", JSON.stringify(summary));
        return summary;
      } catch (err) {
        // Loud failure — this system failing silently is the exact sin it prevents.
        console.error("[follow-up-digest] FAILED", err);
        throw err;
      }
    });
  },
);
