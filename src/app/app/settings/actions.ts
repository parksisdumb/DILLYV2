"use server";

import { requireServerOrgContext } from "@/lib/supabase/server-org";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTestDigest } from "@/lib/notifications/run";

export type ActionResult = { ok: boolean; error?: string; message?: string };

/**
 * Toggle the caller's own morning follow-up digest. Written through the RLS
 * client — the notification_preferences self-policies only allow a user to touch
 * their own row. Default (no row) = ON, so we upsert an explicit row.
 */
export async function setFollowUpDigestPref(enabled: boolean): Promise<ActionResult> {
  try {
    const { supabase, userId, orgId } = await requireServerOrgContext();
    const { error } = await supabase.from("notification_preferences").upsert(
      { org_id: orgId, user_id: userId, follow_up_digest: enabled, updated_at: new Date().toISOString() },
      { onConflict: "org_id,user_id" },
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true, message: enabled ? "Morning digest on." : "Morning digest off." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

/**
 * Admin-only "send me my digest now". Verifies the caller is an org admin, then
 * builds and sends THEIR digest to THEIR own email via the notifications lib
 * (which needs the service-role client for cross-user aggregation). Never sends
 * to anyone but the caller, and never consumes the daily idempotency slot.
 */
export async function sendMyDigestTest(): Promise<ActionResult> {
  try {
    const { supabase, userId, orgId } = await requireServerOrgContext();

    const { data: me } = await supabase
      .from("org_users")
      .select("role,email")
      .eq("user_id", userId)
      .maybeSingle();

    if (me?.role !== "admin") {
      return { ok: false, error: "Only org admins can send a test digest." };
    }
    const toEmail = (me?.email as string | null) ?? null;
    if (!toEmail) return { ok: false, error: "No email on your account to send to." };

    const admin = createAdminClient();
    const res = await sendTestDigest(admin, { orgId, userId, toEmail });
    if (!res.ok) return { ok: false, error: res.error ?? "Send failed." };

    const c = res.counts;
    return {
      ok: true,
      message: `Sent to ${toEmail} — ${c.due_today} due, ${c.overdue} overdue, ${c.cold} cold${c.team_backup ? `, ${c.team_backup} team` : ""}.`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}
