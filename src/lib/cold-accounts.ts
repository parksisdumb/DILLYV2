// "Going cold" detection for ACCOUNTS (relationships), weighted by ICP value.
//
// Pipeline Health flags stalled DEALS. This flags a stalled RELATIONSHIP: an
// account nobody has touched in longer than its priority warrants. A P1 going
// quiet is urgent; a P4 going quiet is noise — so the threshold scales with the
// intrinsic ICP priority from @/lib/scoring/icp-score.
//
// Efficiency: four batch queries, aggregated in memory. No per-account queries.
// RLS scopes every read to the caller's org — no manual org_id filtering.

import type { SupabaseClient } from "@supabase/supabase-js";
import { scoreAccount, scoreAccountIntrinsic } from "@/lib/scoring/icp-score";

const DAY = 86_400_000;

/** Days without a touch before a relationship counts as cold, by ICP priority. */
export const COLD_THRESHOLD_DAYS: Record<1 | 2 | 3 | 4, number> = {
  1: 14,
  2: 21,
  3: 30,
  4: 60,
};

export type ColdAccount = {
  accountId: string;
  accountName: string;
  accountType: string | null;
  /** Displayed ICP badge — includes recency, matches the accounts list. */
  priority: 1 | 2 | 3 | 4;
  icpScore: number;
  /**
   * Recency-free priority that drives the cold threshold and urgency sort. Kept
   * separate from `priority` so a quiet account can never self-demote out of
   * urgency (losing recency points would otherwise LENGTHEN its threshold).
   */
  thresholdPriority: 1 | 2 | 3 | 4;
  intrinsicScore: number;
  /** Days since the last touch — or since the account was created if never touched. */
  daysCold: number;
  lastTouchAt: string | null;
  neverTouched: boolean;
  thresholdDays: number;
  propertyCount: number;
  contactCount: number;
  /** accounts.created_by — the de-facto assigned rep for this account. */
  ownerUserId: string | null;
  /** Most recently touched contact at this account (the one-tap log target). */
  recentContactId: string | null;
  recentContactName: string | null;
};

type MinimalClient = Pick<SupabaseClient, "from">;

export type AccountRow = {
  id: string;
  name: string | null;
  account_type: string | null;
  created_by: string | null;
  created_at: string;
};

export type ColdAccountInputs = {
  accounts: AccountRow[];
  properties: { primary_account_id: string }[];
  contacts: { id: string; full_name: string | null; account_id: string }[];
  /** MUST be ordered newest-first (happened_at desc). */
  touchpoints: { account_id: string; contact_id: string | null; happened_at: string }[];
};

/**
 * Accounts past their priority-based cold threshold, sorted P1-first then coldest.
 * Pass `ownerUserId` to scope to a single rep (the Today card); omit for the whole
 * org (the manager view).
 */
export async function getColdAccounts(
  supabase: MinimalClient,
  opts: { ownerUserId?: string; now?: number } = {},
): Promise<ColdAccount[]> {
  // Four batch reads. Touchpoints are ordered newest-first so the first row seen
  // per account IS its last touch (and the first with a contact is the most
  // recently touched contact) — a single pass, no sorting per account.
  const [acctRes, propRes, contactRes, tpRes] = await Promise.all([
    supabase
      .from("accounts")
      .select("id,name,account_type,created_by,created_at")
      .is("deleted_at", null)
      .limit(2000),
    supabase
      .from("properties")
      .select("primary_account_id")
      .is("deleted_at", null)
      .not("primary_account_id", "is", null)
      .limit(5000),
    supabase
      .from("contacts")
      .select("id,full_name,account_id")
      .is("deleted_at", null)
      .limit(5000),
    supabase
      .from("touchpoints")
      .select("account_id,contact_id,happened_at")
      .not("account_id", "is", null)
      .order("happened_at", { ascending: false })
      .limit(10000),
  ]);

  return computeColdAccounts(
    {
      accounts: (acctRes.data ?? []) as AccountRow[],
      properties: (propRes.data ?? []) as { primary_account_id: string }[],
      contacts: (contactRes.data ?? []) as ColdAccountInputs["contacts"],
      touchpoints: (tpRes.data ?? []) as ColdAccountInputs["touchpoints"],
    },
    opts,
  );
}

/**
 * Pure scoring pass over already-fetched rows. Split out so the same logic can run
 * against any data source (server page, script, tests) without re-querying.
 */
export function computeColdAccounts(
  input: ColdAccountInputs,
  opts: { ownerUserId?: string; now?: number } = {},
): ColdAccount[] {
  const now = opts.now ?? Date.now();
  const { accounts } = input;

  const propertyCount = new Map<string, number>();
  for (const p of input.properties) {
    propertyCount.set(p.primary_account_id, (propertyCount.get(p.primary_account_id) ?? 0) + 1);
  }

  const contactCount = new Map<string, number>();
  const contactName = new Map<string, string | null>();
  for (const c of input.contacts) {
    contactCount.set(c.account_id, (contactCount.get(c.account_id) ?? 0) + 1);
    contactName.set(c.id, c.full_name);
  }

  // Newest-first single pass: first hit per account wins.
  const lastTouch = new Map<string, string>();
  const recentContact = new Map<string, string>();
  for (const t of input.touchpoints) {
    if (!lastTouch.has(t.account_id)) lastTouch.set(t.account_id, t.happened_at);
    if (t.contact_id && !recentContact.has(t.account_id)) {
      recentContact.set(t.account_id, t.contact_id);
    }
  }

  const out: ColdAccount[] = [];

  for (const a of accounts) {
    if (opts.ownerUserId && a.created_by !== opts.ownerUserId) continue;

    const props = propertyCount.get(a.id) ?? 0;
    const contacts = contactCount.get(a.id) ?? 0;
    const lastTouchAt = lastTouch.get(a.id) ?? null;

    // Displayed badge: same inputs the accounts list uses, so it matches app-wide.
    const icp = scoreAccount(
      {
        account_type: a.account_type,
        property_count: props,
        contact_count: contacts,
        last_touch_at: lastTouchAt,
      },
      now,
    );

    // Threshold + urgency: intrinsic factors only. Excluding recency breaks the
    // circularity where going quiet lowers priority and thereby delays detection.
    const intrinsic = scoreAccountIntrinsic({
      account_type: a.account_type,
      property_count: props,
      contact_count: contacts,
    });

    // Never touched → measure from when the account entered the system.
    const since = lastTouchAt ?? a.created_at;
    const sinceMs = new Date(since).getTime();
    if (!Number.isFinite(sinceMs)) continue;

    const daysCold = Math.floor((now - sinceMs) / DAY);
    const thresholdDays = COLD_THRESHOLD_DAYS[intrinsic.priority];
    if (daysCold < thresholdDays) continue;

    const recentContactId = recentContact.get(a.id) ?? null;

    out.push({
      accountId: a.id,
      accountName: a.name ?? "Unnamed account",
      accountType: a.account_type,
      priority: icp.priority,
      icpScore: icp.score,
      thresholdPriority: intrinsic.priority,
      intrinsicScore: intrinsic.score,
      daysCold,
      lastTouchAt,
      neverTouched: lastTouchAt === null,
      thresholdDays,
      propertyCount: props,
      contactCount: contacts,
      ownerUserId: a.created_by,
      recentContactId,
      recentContactName: recentContactId ? (contactName.get(recentContactId) ?? null) : null,
    });
  }

  // Urgency order: recency-free priority first, then coldest within a tier.
  out.sort((x, y) => x.thresholdPriority - y.thresholdPriority || y.daysCold - x.daysCold);
  return out;
}
