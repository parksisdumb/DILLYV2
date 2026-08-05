import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildOrgDigests, dayBounds } from "./build";
import { renderUserEmail } from "./render";
import { appUrl, sendEmail } from "./send";
import type { DigestType, UserDigest } from "./types";

function itemCounts(u: UserDigest) {
  return {
    due_today: u.rep.dueToday.count,
    overdue: u.rep.overdue.count,
    cold: u.rep.cold.count,
    awaiting: u.rep.awaiting.count,
    team_backup: u.team?.repsNeedingBackup ?? 0,
  };
}

function digestTypeFor(u: UserDigest): DigestType {
  return u.rep.role === "manager" || u.rep.role === "admin" ? "manager" : "rep";
}

export type CronSummary = {
  orgs: number;
  considered: number;
  sent: number;
  skippedEmpty: number;
  skippedOptOut: number;
  skippedAlreadySent: number;
  skippedNoEmail: number;
  errors: number;
  errorDetails: { userId: string; error: string }[];
};

/**
 * The daily run. Enumerates every org, builds each user's digest live from
 * next_actions state, and sends to users who (a) have something to report,
 * (b) haven't opted out, and (c) haven't already been sent today (the
 * digest_sends unique claim makes a cron re-run safe). Writes a cron_runs row
 * so a silent failure is visible on the admin console.
 */
export async function runDigestCron(
  admin: SupabaseClient,
  opts: { now?: Date } = {},
): Promise<CronSummary> {
  const now = opts.now ?? new Date();
  const { sendDate } = dayBounds(now);
  const base = appUrl();

  const summary: CronSummary = {
    orgs: 0,
    considered: 0,
    sent: 0,
    skippedEmpty: 0,
    skippedOptOut: 0,
    skippedAlreadySent: 0,
    skippedNoEmail: 0,
    errors: 0,
    errorDetails: [],
  };

  // Open a run row up front so a hard crash leaves a visible 'running' record.
  const { data: runRow } = await admin
    .from("cron_runs")
    .insert({ job: "follow_up_digest", status: "running", started_at: now.toISOString() })
    .select("id")
    .maybeSingle();
  const runId = (runRow as { id: string } | null)?.id ?? null;

  try {
    const { data: orgs, error: orgErr } = await admin.from("orgs").select("id");
    if (orgErr) throw new Error(`orgs read failed: ${orgErr.message}`);

    // Users who turned off their own morning digest. (Overdue still escalates to
    // managers — that lives in the MANAGER's own email, unaffected by this.)
    const { data: prefs } = await admin
      .from("notification_preferences")
      .select("user_id")
      .eq("follow_up_digest", false);
    const optedOut = new Set((prefs ?? []).map((p) => p.user_id as string));

    summary.orgs = (orgs ?? []).length;

    for (const org of (orgs ?? []) as { id: string }[]) {
      const digests = await buildOrgDigests(admin, org.id, { now });

      for (const u of digests.values()) {
        summary.considered++;

        if (u.isEmpty) {
          summary.skippedEmpty++;
          continue;
        }
        if (optedOut.has(u.rep.userId)) {
          summary.skippedOptOut++;
          continue;
        }
        if (!u.rep.email) {
          summary.skippedNoEmail++;
          continue;
        }

        const digestType = digestTypeFor(u);

        // Claim the once-per-day slot. ignoreDuplicates → a conflict returns no
        // row, meaning we (or a prior run) already sent today: skip.
        const { data: claimed, error: claimErr } = await admin
          .from("digest_sends")
          .upsert(
            {
              org_id: org.id,
              user_id: u.rep.userId,
              digest_type: digestType,
              send_date: sendDate,
              status: "claimed",
              item_counts: itemCounts(u),
            },
            { onConflict: "user_id,digest_type,send_date", ignoreDuplicates: true },
          )
          .select("id");

        if (claimErr) {
          summary.errors++;
          summary.errorDetails.push({ userId: u.rep.userId, error: `claim: ${claimErr.message}` });
          continue;
        }
        if (!claimed || claimed.length === 0) {
          summary.skippedAlreadySent++;
          continue;
        }
        const claimId = (claimed[0] as { id: string }).id;

        const { subject, html, text } = renderUserEmail(u, base);
        const result = await sendEmail({ to: u.rep.email, subject, html, text });

        if (result.ok) {
          summary.sent++;
          await admin
            .from("digest_sends")
            .update({ status: "sent", provider_message_id: result.id })
            .eq("id", claimId);
        } else {
          summary.errors++;
          summary.errorDetails.push({ userId: u.rep.userId, error: result.error });
          // Release the claim so a same-day re-run (e.g. after fixing RESEND_API_KEY)
          // retries this user instead of the slot staying stuck. The error is still
          // captured in the cron_runs summary. (A new day is a new send_date anyway.)
          await admin.from("digest_sends").delete().eq("id", claimId);
        }
      }
    }

    if (runId) {
      await admin
        .from("cron_runs")
        .update({
          status: summary.errors > 0 ? "error" : "ok",
          finished_at: new Date().toISOString(),
          summary,
          error: summary.errors > 0 ? `${summary.errors} send error(s)` : null,
        })
        .eq("id", runId);
    }

    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (runId) {
      await admin
        .from("cron_runs")
        .update({ status: "error", finished_at: new Date().toISOString(), summary, error: message.slice(0, 500) })
        .eq("id", runId);
    }
    throw err;
  }
}

/**
 * Build and send ONE user's digest immediately — the admin "send me my digest
 * now" test button. Bypasses opt-out and the daily idempotency claim (a test must
 * never consume the real morning slot), and sends even when empty so the tester
 * sees the caught-up state. Does not write digest_sends.
 */
export async function sendTestDigest(
  admin: SupabaseClient,
  args: { orgId: string; userId: string; toEmail: string; now?: Date },
): Promise<{ ok: boolean; error?: string; counts: ReturnType<typeof itemCounts> }> {
  const now = args.now ?? new Date();
  const digests = await buildOrgDigests(admin, args.orgId, { now, onlyUserId: args.userId });
  const u = digests.get(args.userId);
  if (!u) return { ok: false, error: "No digest could be built for this user.", counts: { due_today: 0, overdue: 0, cold: 0, awaiting: 0, team_backup: 0 } };

  const { subject, html, text } = renderUserEmail(u, appUrl());
  const result = await sendEmail({ to: args.toEmail, subject, html, text });
  return result.ok
    ? { ok: true, counts: itemCounts(u) }
    : { ok: false, error: result.error, counts: itemCounts(u) };
}
