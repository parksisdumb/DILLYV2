import { inngest } from "../client";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProvider } from "@/lib/email";
import { encryptToken, decryptToken } from "@/lib/email/crypto";
import type { EmailMessageMeta } from "@/lib/email/types";

// Phase-1 caps. Backfill is a one-time cost on first connect; incremental syncs
// (every 15 min) normally see a handful of new messages.
const BACKFILL_DAYS = 30;
const MAX_BACKFILL_PER_LABEL = 200;
const MAX_MESSAGES_PER_RUN = 200;
const TOKEN_SKEW_MS = 60_000;

type Connection = {
  org_id: string;
  user_id: string;
  email_address: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  history_id: string | null;
};

// ── Scheduler: fan out one sync event per connected user every 15 min ─────────
export const gmailSyncScheduler = inngest.createFunction(
  {
    id: "gmail-sync-scheduler",
    triggers: [{ cron: "*/15 * * * *" }, { event: "app/gmail.sync.all" }],
  },
  async ({ step }) => {
    const supabase = createAdminClient();

    const userIds = await step.run("load-connected", async () => {
      const { data } = await supabase
        .from("email_connections")
        .select("user_id")
        .eq("provider", "gmail")
        .eq("status", "active");
      return (data ?? []).map((r) => r.user_id as string);
    });

    if (userIds.length > 0) {
      await step.sendEvent(
        "fan-out",
        userIds.map((userId) => ({ name: "app/gmail.sync.user", data: { userId } })),
      );
    }

    return { dispatched: userIds.length };
  },
);

// ── Worker: sync one user's mailbox ──────────────────────────────────────────
export const gmailSyncUser = inngest.createFunction(
  {
    id: "gmail-sync-user",
    retries: 1,
    // Cap concurrent mailbox syncs so a big fan-out doesn't hammer Gmail/DB.
    concurrency: { limit: 8 },
    triggers: [{ event: "app/gmail.sync.user" }],
  },
  async ({ event, step }) => {
    const userId = (event.data as { userId?: string })?.userId;
    if (!userId) return { skipped: "no userId" };

    return await step.run("sync-user", async () => syncOneUser(userId));
  },
);

async function syncOneUser(userId: string) {
  const supabase = createAdminClient();
  const provider = getProvider("gmail");

  const { data: connRow } = await supabase
    .from("email_connections")
    .select("org_id,user_id,email_address,access_token_enc,refresh_token_enc,token_expires_at,history_id")
    .eq("user_id", userId)
    .eq("provider", "gmail")
    .eq("status", "active")
    .maybeSingle();

  const conn = connRow as Connection | null;
  if (!conn || !conn.refresh_token_enc) return { skipped: "no active connection" };

  try {
    // 1) Ensure a fresh access token.
    let accessToken = conn.access_token_enc ? decryptToken(conn.access_token_enc) : "";
    const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
    if (!accessToken || expiresAt - Date.now() < TOKEN_SKEW_MS) {
      const refreshed = await provider.refresh(decryptToken(conn.refresh_token_enc));
      accessToken = refreshed.accessToken;
      await supabase
        .from("email_connections")
        .update({
          access_token_enc: encryptToken(refreshed.accessToken),
          token_expires_at: refreshed.expiresAt,
        })
        .eq("user_id", userId)
        .eq("provider", "gmail");
    }

    // 2) Gather candidate message ids (incremental via history, or first-run backfill).
    let messageIds: string[] = [];
    let nextHistoryId: string | null = conn.history_id;
    let backfillMode = false;

    if (conn.history_id) {
      const r = await provider.listSince({ accessToken, historyId: conn.history_id });
      if (r.newHistoryId === null) {
        // Cursor expired — re-backfill and reset the cursor from the profile.
        backfillMode = true;
        messageIds = await provider.backfill({ accessToken, maxPerLabel: MAX_BACKFILL_PER_LABEL });
        nextHistoryId = (await provider.getProfile(accessToken)).historyId;
      } else {
        messageIds = r.messageIds;
        nextHistoryId = r.newHistoryId ?? conn.history_id;
      }
    } else {
      backfillMode = true;
      nextHistoryId = (await provider.getProfile(accessToken)).historyId;
      messageIds = await provider.backfill({ accessToken, maxPerLabel: MAX_BACKFILL_PER_LABEL });
    }

    messageIds = messageIds.slice(0, MAX_MESSAGES_PER_RUN);

    // 3) Fetch metadata; in backfill mode drop anything older than the window.
    const cutoff = Date.now() - BACKFILL_DAYS * 86_400_000;
    const metas: EmailMessageMeta[] = [];
    for (const id of messageIds) {
      const m = await provider.getMessage({ accessToken, messageId: id });
      if (!m) continue;
      if (backfillMode && new Date(m.date).getTime() < cutoff) continue;
      metas.push(m);
    }

    // 4) Batch-match counterparties to org contacts (case-insensitive).
    const emailSet = new Set<string>();
    for (const m of metas) {
      const counterparts = m.direction === "outbound" ? m.to : m.from ? [m.from] : [];
      counterparts.forEach((e) => emailSet.add(e));
    }

    const emailToContact = new Map<string, { id: string }>();
    if (emailSet.size > 0) {
      const { data: contacts } = await supabase
        .from("contacts")
        .select("id,email_normalized")
        .eq("org_id", conn.org_id)
        .in("email_normalized", [...emailSet])
        .is("deleted_at", null)
        .order("updated_at", { ascending: false, nullsFirst: false });
      for (const c of contacts ?? []) {
        const key = c.email_normalized as string;
        if (key && !emailToContact.has(key)) emailToContact.set(key, { id: c.id as string });
      }
    }

    // 5) Log matched messages (idempotent on gmail_message_id).
    let logged = 0;
    for (const m of metas) {
      const counterparts = m.direction === "outbound" ? m.to : m.from ? [m.from] : [];
      let contactId: string | null = null;
      for (const e of counterparts) {
        const hit = emailToContact.get(e);
        if (hit) {
          contactId = hit.id;
          break;
        }
      }
      if (!contactId) continue;

      const { data: tpId, error } = await supabase.rpc("rpc_log_synced_email_touchpoint", {
        p_org_id: conn.org_id,
        p_user_id: conn.user_id,
        p_contact_id: contactId,
        p_direction: m.direction,
        p_happened_at: m.date,
        p_subject: m.subject,
        p_gmail_message_id: m.messageId,
        p_thread_id: m.threadId,
        p_from_email: m.from,
        p_to_emails: m.to,
      });
      if (!error && tpId) logged++;
    }

    await supabase
      .from("email_connections")
      .update({
        history_id: nextHistoryId,
        last_synced_at: new Date().toISOString(),
        status: "active",
        last_error: null,
      })
      .eq("user_id", userId)
      .eq("provider", "gmail");

    return { userId, candidates: messageIds.length, matched: logged, backfill: backfillMode };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("email_connections")
      .update({ status: "error", last_error: message.slice(0, 500) })
      .eq("user_id", userId)
      .eq("provider", "gmail");
    return { userId, error: message };
  }
}
