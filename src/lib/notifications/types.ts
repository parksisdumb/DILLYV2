import type { OverdueTier } from "@/lib/overdue";
import type { ColdTier } from "@/lib/cold-accounts";

// Shared shapes for the follow-up digest. Everything here is derived LIVE from
// next_actions / touchpoints / synced_emails at build time — there is no stored
// alert state, so a completed/dismissed item simply never appears, and a snoozed
// item reappears once its new due date passes.

export type DigestType = "rep" | "manager";

export type DueItem = {
  contactId: string;
  contactName: string;
  accountId: string;
  accountName: string;
  note: string | null;
  daysSinceTouch: number | null;
};

export type OverdueItem = DueItem & {
  daysOverdue: number;
  tier: Exclude<OverdueTier, "none">;
};

export type ColdItem = {
  accountId: string;
  accountName: string;
  /** P1–P4 label from the cold TIER rank (A→P1 … D→P4). */
  priorityLabel: string;
  tier: ColdTier;
  daysCold: number;
  neverTouched: boolean;
};

export type AwaitingItem = {
  contactId: string | null;
  contactName: string;
  subject: string | null;
  daysWaiting: number;
};

export type RepDigest = {
  userId: string;
  orgId: string;
  email: string | null;
  name: string;
  role: string;
  dueToday: { count: number; items: DueItem[] };
  overdue: { count: number; items: OverdueItem[] };
  cold: { count: number; items: ColdItem[] };
  awaiting: { active: boolean; count: number; items: AwaitingItem[] };
};

/** One team member's line in a manager digest — coaching, not surveillance. */
export type ManagerRepLine = {
  userId: string;
  name: string;
  dueTodayCount: number;
  overdueCount: number;
  /** Items 5+ days overdue, named individually (oldest first). */
  overdue5Plus: { name: string; account: string; daysOverdue: number }[];
  chronicSnoozeCount: number;
  p1ColdCount: number;
  p1ColdNames: string[];
};

export type ManagerTeam = {
  rows: ManagerRepLine[];
  teamOverdueTotal: number;
  repsNeedingBackup: number;
};

/** A rep digest plus an optional team section (managers/admins only). */
export type UserDigest = {
  rep: RepDigest;
  team: ManagerTeam | null;
  /** True when there is nothing worth an email (skip the send). */
  isEmpty: boolean;
};
