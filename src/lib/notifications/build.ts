import "server-only";

import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_TIME_ZONE } from "@/lib/time";
import { daysOverdue, overdueTier, isChronicSnooze, selectWithOptionalCols } from "@/lib/overdue";
import {
  computeColdAccounts,
  COLD_TIER_RANK,
  type ColdAccount,
  type ColdAccountInputs,
} from "@/lib/cold-accounts";
import type {
  AwaitingItem,
  DueItem,
  ManagerRepLine,
  ManagerTeam,
  OverdueItem,
  RepDigest,
  UserDigest,
} from "./types";

const DAY = 86_400_000;
// A sent email that hasn't been replied to is only "awaiting" after a business
// beat — otherwise every just-sent thread would nag. Two days.
const AWAITING_MIN_DAYS = 2;

// Display caps (email stays scannable; counts always reflect the true total).
const DUE_CAP = 10;
const OVERDUE_CAP = 20;
const COLD_CAP = 8;
const AWAITING_CAP = 5;
const MANAGER_NAMED_CAP = 8;

type Admin = Pick<SupabaseClient, "from">;

export function dayBounds(now: Date, tz: string = APP_TIME_ZONE) {
  const startToday = DateTime.fromJSDate(now).setZone(tz).startOf("day");
  return {
    startTodayMs: startToday.toMillis(),
    startTodayIso: startToday.toUTC().toISO()!,
    startTomorrowIso: startToday.plus({ days: 1 }).toUTC().toISO()!,
    sendDate: startToday.toISODate()!, // YYYY-MM-DD in the app timezone
  };
}

function displayName(fullName: string | null, email: string | null, userId: string): string {
  return fullName?.trim() || email?.split("@")[0] || userId.slice(0, 8);
}

// Full per-rep computation kept internally (uncapped) so the manager rollup can
// count/name beyond the rep-email display caps.
type RepCompute = {
  userId: string;
  name: string;
  email: string | null;
  role: string;
  due: DueItem[];
  overdue: OverdueItem[];
  cold: RepDigest["cold"]["items"];
  chronicSnoozeCount: number;
  awaitingActive: boolean;
  awaiting: AwaitingItem[];
};

/**
 * Build a digest for every user in one org. Reads are explicitly org-scoped
 * because the caller is the service-role admin client (RLS does not apply) — the
 * gmail-sync pattern.
 */
export async function buildOrgDigests(
  admin: Admin,
  orgId: string,
  opts: { now?: Date; onlyUserId?: string } = {},
): Promise<Map<string, UserDigest>> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const { startTodayMs, startTomorrowIso } = dayBounds(now);

  const [
    usersRes,
    contactsRes,
    accountsRes,
    propsRes,
    assignRes,
    tpsRes,
    connRes,
    syncedRes,
  ] = await Promise.all([
    admin.from("org_users").select("user_id,role,full_name,email").eq("org_id", orgId),
    admin.from("contacts").select("id,full_name,title,account_id").eq("org_id", orgId).is("deleted_at", null),
    admin
      .from("accounts")
      .select("id,name,account_type,created_by,created_at")
      .eq("org_id", orgId)
      .is("deleted_at", null),
    admin
      .from("properties")
      .select("primary_account_id")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .not("primary_account_id", "is", null),
    admin.from("account_assignments").select("account_id,user_id").eq("org_id", orgId),
    admin
      .from("touchpoints")
      .select("account_id,contact_id,happened_at")
      .eq("org_id", orgId)
      .order("happened_at", { ascending: false })
      .limit(20000),
    admin.from("email_connections").select("user_id,status,provider").eq("org_id", orgId),
    admin
      .from("synced_emails")
      .select("user_id,thread_id,direction,matched_contact_id,subject,message_ts")
      .eq("org_id", orgId)
      .order("message_ts", { ascending: false })
      .limit(20000),
  ]);

  // Open next_actions (any age — overdue can be older than any window). Snooze
  // columns are optional (migration 77) — degrade gracefully if absent.
  const { data: openActions } = await selectWithOptionalCols<{
    id: string;
    assigned_user_id: string | null;
    contact_id: string | null;
    account_id: string | null;
    due_at: string;
    notes: string | null;
    snoozed_count: number | null;
  }>(
    (cols) => admin.from("next_actions").select(cols).eq("org_id", orgId).eq("status", "open"),
    "id,assigned_user_id,contact_id,account_id,due_at,notes",
    "snoozed_count",
  );

  const users = (usersRes.data ?? []) as { user_id: string; role: string; full_name: string | null; email: string | null }[];

  // ── Lookup maps ────────────────────────────────────────────────────────────
  const contactName = new Map<string, string>();
  for (const c of (contactsRes.data ?? []) as { id: string; full_name: string | null }[]) {
    contactName.set(c.id, c.full_name?.trim() || "Unknown contact");
  }
  const accountName = new Map<string, string>();
  for (const a of (accountsRes.data ?? []) as { id: string; name: string | null }[]) {
    accountName.set(a.id, a.name?.trim() || "Unnamed account");
  }

  // Latest touch per contact (touchpoints already newest-first → first hit wins).
  const lastTouchByContact = new Map<string, string>();
  for (const t of (tpsRes.data ?? []) as { contact_id: string | null; happened_at: string }[]) {
    if (t.contact_id && !lastTouchByContact.has(t.contact_id)) {
      lastTouchByContact.set(t.contact_id, t.happened_at);
    }
  }

  // Cold accounts computed once for the whole org, then filtered per rep.
  const coldInputs: ColdAccountInputs = {
    accounts: (accountsRes.data ?? []) as ColdAccountInputs["accounts"],
    properties: (propsRes.data ?? []) as { primary_account_id: string }[],
    contacts: (contactsRes.data ?? []) as ColdAccountInputs["contacts"],
    touchpoints: (tpsRes.data ?? []) as ColdAccountInputs["touchpoints"],
    assignments: (assignRes.data ?? []) as ColdAccountInputs["assignments"],
  };
  const allCold = computeColdAccounts(coldInputs, { now: nowMs });
  const coldByUser = new Map<string, ColdAccount[]>();
  for (const c of allCold) {
    for (const uid of c.assignedUserIds) {
      const list = coldByUser.get(uid) ?? [];
      list.push(c);
      coldByUser.set(uid, list);
    }
  }

  // Active email connection per user (gates the awaiting-reply section).
  const emailActive = new Set<string>();
  for (const c of (connRes.data ?? []) as { user_id: string; status: string; provider: string }[]) {
    if (c.status === "active") emailActive.add(c.user_id);
  }

  // Awaiting reply: per user, the latest message per thread. If that message is
  // outbound to a known contact and old enough, we're waiting on them.
  const seenThread = new Set<string>(); // user_id|thread_id — first (newest) wins
  const awaitingByUser = new Map<string, AwaitingItem[]>();
  for (const m of (syncedRes.data ?? []) as {
    user_id: string;
    thread_id: string | null;
    direction: string;
    matched_contact_id: string | null;
    subject: string | null;
    message_ts: string;
  }[]) {
    const threadKey = `${m.user_id}|${m.thread_id ?? m.message_ts}`;
    if (seenThread.has(threadKey)) continue; // not the newest message in this thread
    seenThread.add(threadKey);
    if (m.direction !== "outbound" || !m.matched_contact_id) continue;
    const days = Math.floor((nowMs - new Date(m.message_ts).getTime()) / DAY);
    if (days < AWAITING_MIN_DAYS) continue;
    const list = awaitingByUser.get(m.user_id) ?? [];
    list.push({
      contactId: m.matched_contact_id,
      contactName: contactName.get(m.matched_contact_id) ?? "Unknown contact",
      subject: m.subject,
      daysWaiting: days,
    });
    awaitingByUser.set(m.user_id, list);
  }

  // Group open actions by assigned rep.
  const actionsByUser = new Map<string, typeof openActions>();
  for (const a of openActions) {
    if (!a.assigned_user_id || !a.contact_id || !a.account_id) continue;
    const list = actionsByUser.get(a.assigned_user_id) ?? [];
    list.push(a);
    actionsByUser.set(a.assigned_user_id, list);
  }

  // ── Per-rep compute ─────────────────────────────────────────────────────────
  const computes = new Map<string, RepCompute>();
  for (const u of users) {
    const actions = actionsByUser.get(u.user_id) ?? [];

    const due: DueItem[] = [];
    const overdue: OverdueItem[] = [];
    let chronic = 0;

    for (const a of actions) {
      if (isChronicSnooze(a.snoozed_count)) chronic++;
      const dueMs = new Date(a.due_at).getTime();
      const item: DueItem = {
        contactId: a.contact_id!,
        contactName: contactName.get(a.contact_id!) ?? "Unknown contact",
        accountId: a.account_id!,
        accountName: accountName.get(a.account_id!) ?? "Unnamed account",
        note: a.notes,
        daysSinceTouch: a.contact_id && lastTouchByContact.has(a.contact_id)
          ? Math.floor((nowMs - new Date(lastTouchByContact.get(a.contact_id)!).getTime()) / DAY)
          : null,
      };
      if (dueMs >= startTodayMs && a.due_at < startTomorrowIso) {
        due.push(item);
      } else if (dueMs < startTodayMs) {
        const d = daysOverdue(a.due_at, nowMs);
        const tier = overdueTier(a.due_at, nowMs);
        if (tier !== "none") overdue.push({ ...item, daysOverdue: d, tier });
      }
    }

    due.sort((x, y) => (x.contactName > y.contactName ? 1 : -1));
    overdue.sort((x, y) => y.daysOverdue - x.daysOverdue); // oldest (most overdue) first

    const cold = (coldByUser.get(u.user_id) ?? []).map((c) => ({
      accountId: c.accountId,
      accountName: c.accountName,
      priorityLabel: `P${COLD_TIER_RANK[c.tier]}`,
      tier: c.tier,
      daysCold: c.daysCold,
      neverTouched: c.neverTouched,
    }));

    const awaiting = (awaitingByUser.get(u.user_id) ?? []).sort((a, b) => b.daysWaiting - a.daysWaiting);

    computes.set(u.user_id, {
      userId: u.user_id,
      name: displayName(u.full_name, u.email, u.user_id),
      email: u.email,
      role: u.role,
      due,
      overdue,
      cold,
      chronicSnoozeCount: chronic,
      awaitingActive: emailActive.has(u.user_id),
      awaiting,
    });
  }

  // ── Assemble per-user digests (rep sections + optional team section) ─────────
  const out = new Map<string, UserDigest>();
  const wantUsers = opts.onlyUserId ? users.filter((u) => u.user_id === opts.onlyUserId) : users;

  for (const u of wantUsers) {
    const c = computes.get(u.user_id)!;
    const rep: RepDigest = {
      userId: c.userId,
      orgId,
      email: c.email,
      name: c.name,
      role: c.role,
      dueToday: { count: c.due.length, items: c.due.slice(0, DUE_CAP) },
      overdue: { count: c.overdue.length, items: c.overdue.slice(0, OVERDUE_CAP) },
      cold: { count: c.cold.length, items: c.cold.slice(0, COLD_CAP) },
      awaiting: {
        active: c.awaitingActive,
        count: c.awaiting.length,
        items: c.awaiting.slice(0, AWAITING_CAP),
      },
    };

    const isManager = c.role === "manager" || c.role === "admin";
    const team = isManager ? buildManagerTeam(computes) : null;

    const repHasContent =
      rep.dueToday.count > 0 || rep.overdue.count > 0 || rep.cold.count > 0 || rep.awaiting.count > 0;
    const teamHasContent = (team?.repsNeedingBackup ?? 0) > 0;

    out.set(u.user_id, { rep, team, isEmpty: !repHasContent && !teamHasContent });
  }

  return out;
}

/** Roll the whole team's computes into a manager coaching section. */
function buildManagerTeam(computes: Map<string, RepCompute>): ManagerTeam {
  const rows: ManagerRepLine[] = [];
  let teamOverdueTotal = 0;

  for (const c of computes.values()) {
    const p1Cold = c.cold.filter((x) => x.tier === "A");
    const overdue5Plus = c.overdue
      .filter((o) => o.daysOverdue >= 5)
      .slice(0, MANAGER_NAMED_CAP)
      .map((o) => ({ name: o.contactName, account: o.accountName, daysOverdue: o.daysOverdue }));

    teamOverdueTotal += c.overdue.length;

    const needsBackup = c.overdue.length > 0 || c.chronicSnoozeCount > 0 || p1Cold.length > 0;
    if (!needsBackup) continue;

    rows.push({
      userId: c.userId,
      name: c.name,
      dueTodayCount: c.due.length,
      overdueCount: c.overdue.length,
      overdue5Plus,
      chronicSnoozeCount: c.chronicSnoozeCount,
      p1ColdCount: p1Cold.length,
      p1ColdNames: p1Cold.slice(0, MANAGER_NAMED_CAP).map((x) => x.accountName),
    });
  }

  // Most-behind first: overdue, then P1 cold, then chronic.
  rows.sort(
    (a, b) =>
      b.overdueCount - a.overdueCount ||
      b.p1ColdCount - a.p1ColdCount ||
      b.chronicSnoozeCount - a.chronicSnoozeCount,
  );

  return { rows, teamOverdueTotal, repsNeedingBackup: rows.length };
}
