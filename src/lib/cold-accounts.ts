// "Going cold" detection for ACCOUNTS (relationships), weighted by intrinsic value.
//
// Pipeline Health flags stalled DEALS. This flags a stalled RELATIONSHIP: an
// account nobody has touched in longer than its value warrants. A high-value
// account going quiet is urgent; a zero-value one is noise.
//
// The cold TIER is derived directly from intrinsic signals — account type and
// portfolio size — NOT from the recency-inclusive ICP score. Recency is
// deliberately excluded: an account going quiet must never lengthen its own
// threshold and delay the alert. (scoreAccount() and the accounts-list badge are
// untouched by any of this.)
//
// Efficiency: four batch queries, aggregated in memory. No per-account queries.
// RLS scopes every read to the caller's org — no manual org_id filtering.

import type { SupabaseClient } from "@supabase/supabase-js";
import { scoreAccount } from "@/lib/scoring/icp-score";

const DAY = 86_400_000;

// Cold tiers, most-urgent first. Thresholds intentionally wider in the middle than
// the old 20+-property-only top tier so real property-management volume (8-19
// properties) is held to a tighter cadence.
export type ColdTier = "A" | "B" | "C" | "D";

export const COLD_TIER_DAYS: Record<ColdTier, number> = {
  A: 14,
  B: 21,
  C: 30,
  D: 60,
};

// Numeric rank of each tier (A=1 … D=4) for the P-badge + urgency sort.
export const COLD_TIER_RANK: Record<ColdTier, 1 | 2 | 3 | 4> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
};

/**
 * Cold tier from intrinsic signals only (account type + portfolio size) —
 * evaluated most-urgent-first.
 *
 *   A (14d): 20+ properties, OR property-mgmt/asset-mgmt with 8+ properties
 *   B (21d): 8-19 properties, OR property-mgmt/asset-mgmt/owner with 1+ properties,
 *            OR facilities-management with 3+ properties
 *   C (30d): 1-7 properties
 *   D (60d): 0 properties, or vendor/other account types (low intrinsic value,
 *            demoted regardless of portfolio size)
 *
 * The type floors mirror the ICP value model (PM/AM/owner top-value; facilities a
 * high-mid channel). They are calibrated so no account lands on a LONGER cold
 * window than the previous score-based thresholds gave it — verified against prod.
 */
export function coldTier(accountType: string | null | undefined, propertyCount: number): ColdTier {
  const t = (accountType ?? "").toLowerCase();
  const pmAm = t === "commercial_property_management" || t === "asset_management";
  const pmAmOwner = pmAm || t === "owner";
  const facilities = t === "facilities_management";
  const lowValue = t === "vendor" || t === "other";
  const p = Math.max(0, propertyCount);

  // Low-value types and zero-portfolio accounts are Tier D regardless of size.
  if (lowValue || p === 0) return "D";
  if (p >= 20 || (pmAm && p >= 8)) return "A";
  if ((p >= 8 && p <= 19) || (pmAmOwner && p >= 1) || (facilities && p >= 3)) return "B";
  if (p >= 1 && p <= 7) return "C";
  return "D";
}

export type ColdAccount = {
  accountId: string;
  accountName: string;
  accountType: string | null;
  /** Displayed ICP badge — includes recency, matches the accounts list. Not what
   *  drives the cold threshold, and not badged on the cold surfaces. */
  priority: 1 | 2 | 3 | 4;
  icpScore: number;
  /** Cold tier letter (A–D). */
  tier: ColdTier;
  /** Numeric rank of the cold tier (A=1 … D=4) — badged + sorted on cold surfaces. */
  thresholdPriority: 1 | 2 | 3 | 4;
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

    // Threshold + urgency: cold TIER from intrinsic signals only (type + portfolio).
    // Excluding recency breaks the circularity where going quiet delays detection.
    const tier = coldTier(a.account_type, props);
    const thresholdDays = COLD_TIER_DAYS[tier];

    // Never touched → measure from when the account entered the system.
    const since = lastTouchAt ?? a.created_at;
    const sinceMs = new Date(since).getTime();
    if (!Number.isFinite(sinceMs)) continue;

    const daysCold = Math.floor((now - sinceMs) / DAY);
    if (daysCold < thresholdDays) continue;

    const recentContactId = recentContact.get(a.id) ?? null;

    out.push({
      accountId: a.id,
      accountName: a.name ?? "Unnamed account",
      accountType: a.account_type,
      priority: icp.priority,
      icpScore: icp.score,
      tier,
      thresholdPriority: COLD_TIER_RANK[tier],
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
