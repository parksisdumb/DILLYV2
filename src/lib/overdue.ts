// Overdue handling for next_actions — shared by the Advance list (rep) and the
// manager Compliance view so tiers, thresholds, and snooze options match exactly.

import type { PostgrestError } from "@supabase/supabase-js";

const DAY = 86_400_000;

export type OverdueTier = "none" | "amber" | "orange" | "red";

/** Days a due date is overdue (0 if due today or future). */
export function daysOverdue(dueAtIso: string, now: number = Date.now()): number {
  const diff = now - new Date(dueAtIso).getTime();
  return diff <= 0 ? 0 : Math.floor(diff / DAY);
}

/** Overdue severity tier: 1-3 days amber, 4-7 orange, 8+ red. */
export function overdueTier(dueAtIso: string, now: number = Date.now()): OverdueTier {
  const d = daysOverdue(dueAtIso, now);
  if (d <= 0) return "none";
  if (d <= 3) return "amber";
  if (d <= 7) return "orange";
  return "red";
}

// Tailwind classes per tier — card background/border and the badge.
export const OVERDUE_TIER_STYLES: Record<Exclude<OverdueTier, "none">, { card: string; badge: string }> = {
  amber: { card: "border-amber-300 bg-amber-50", badge: "bg-amber-100 text-amber-800" },
  orange: { card: "border-orange-300 bg-orange-50", badge: "bg-orange-100 text-orange-800" },
  red: { card: "border-red-300 bg-red-50", badge: "bg-red-100 text-red-700" },
};

/** Snoozing 3+ times marks an item chronic — a dead lead or avoidance signal. */
export const CHRONIC_SNOOZE_THRESHOLD = 3;

export function isChronicSnooze(snoozedCount: number | null | undefined): boolean {
  return (snoozedCount ?? 0) >= CHRONIC_SNOOZE_THRESHOLD;
}

// Quick snooze presets. `days === null` means "pick a date" (handled in the UI).
export type SnoozePreset = { key: string; label: string; days: number | null };
export const SNOOZE_PRESETS: SnoozePreset[] = [
  { key: "tomorrow", label: "Tomorrow", days: 1 },
  { key: "3days", label: "3 days", days: 3 },
  { key: "nextweek", label: "Next week", days: 7 },
  { key: "pick", label: "Pick a date", days: null },
];

/** Snoozing rolls forward from TODAY (not the old due date) so an item that's
 *  already weeks overdue lands the chosen number of days from now, at 9am local. */
export function snoozeDueDate(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

/** `YYYY-MM-DD` at 9am local as an ISO timestamp (for the "pick a date" input). */
export function dateInputToDueIso(dateStr: string): string {
  return new Date(`${dateStr}T09:00:00`).toISOString();
}

export const DISMISS_REASONS: { key: string; label: string }[] = [
  { key: "not_interested", label: "Not interested" },
  { key: "wrong_contact", label: "Wrong contact" },
  { key: "no_longer_relevant", label: "No longer relevant" },
  { key: "handled_elsewhere", label: "Handled elsewhere" },
];

// The snooze/dismiss columns are added by 20260724100000_next_actions_snooze_dismiss.
// Until that migration is applied to prod, selecting/writing them errors 42703 —
// so every read/write that touches them degrades gracefully.
export function isMissingColumnError(error: PostgrestError | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /column .* does not exist/i.test(error.message ?? "")
  );
}

/**
 * Run a next_actions select that includes the optional snooze columns; if those
 * columns don't exist yet (migration not applied), transparently retry with just
 * the base columns. `runSelect(cols)` applies `.select(cols)` plus any filters.
 */
export async function selectWithOptionalCols<T>(
  runSelect: (cols: string) => PromiseLike<{ data: unknown[] | null; error: PostgrestError | null }>,
  baseCols: string,
  optionalCols: string,
): Promise<{ data: T[]; error: PostgrestError | null; hadOptional: boolean }> {
  const full = await runSelect(`${baseCols},${optionalCols}`);
  if (full.error && isMissingColumnError(full.error)) {
    const base = await runSelect(baseCols);
    return { data: (base.data ?? []) as T[], error: base.error, hadOptional: false };
  }
  return { data: (full.data ?? []) as T[], error: full.error, hadOptional: true };
}
