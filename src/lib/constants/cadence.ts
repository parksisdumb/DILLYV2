// Follow-up cadence engine — the SINGLE source of truth for how long until the
// next touch after each outcome, and the suggested next-action note.
//
// Tune intervals/notes here without touching any logic. Keyed by
// touchpoint_outcomes.key (prod-verified keys, including legacy aliases so a
// touchpoint logged against an older key still schedules a follow-up).
//
// Used by the log form (Today → Grow) and Focus Mode to auto-schedule the next
// touch when an outcome is logged. See cadenceFor / cadenceDueDate.

export type CadenceRule = {
  /** Days from the touchpoint date until the next touch is due. */
  days: number;
  /** Suggested next-action note, pre-filled into the follow-up. */
  note: string;
};

// outcome key → cadence. Add/adjust rows here to tune the engine.
export const CADENCE_BY_OUTCOME: Record<string, CadenceRule> = {
  connected_conversation: { days: 7, note: "Follow up on conversation" },
  connected: { days: 7, note: "Follow up on conversation" }, // legacy alias
  no_answer_voicemail: { days: 3, note: "Try again" },
  no_answer: { days: 3, note: "Try again" }, // legacy alias
  no_answer_no_voicemail: { days: 2, note: "Try again" },
  gatekeeper: { days: 5, note: "Try a different time or contact" },
  callback_requested: { days: 1, note: "Return their call" },
  // "Day after the inspection" — the form lets the rep set the exact inspection
  // date; this 1-day default anchors off the log date when none is given.
  inspection_scheduled: { days: 1, note: "Follow up on inspection findings" },
  inspection_set: { days: 1, note: "Follow up on inspection findings" }, // legacy alias
  met_in_person: { days: 10, note: "Follow up on meeting" },
  bid_submitted: { days: 5, note: "Check on proposal" },
  not_interested: { days: 90, note: "Long-term nurture check-in" },
  email_sent: { days: 4, note: "Follow up if no reply" },
  follow_up_sent: { days: 4, note: "Follow up if no reply" }, // legacy alias
  email_replied: { days: 2, note: "Respond" },
};

// Terminal / no-follow-up outcomes — explicitly no cadence (deal is closed or the
// channel is dead, so scheduling a touch would be noise).
export const NO_CADENCE_OUTCOMES = new Set<string>([
  "won",
  "lost",
  "email_bounced",
  "not_available",
]);

// Fallback when an outcome has no explicit rule and isn't terminal — a gentle
// default so no logged touchpoint ever silently leaks with no next action.
export const DEFAULT_CADENCE: CadenceRule = { days: 3, note: "Follow up" };

/**
 * The cadence rule for an outcome. Returns null ONLY for terminal outcomes
 * (won/lost/bounced/not-available). An unknown or missing outcome falls back to
 * DEFAULT_CADENCE so every logged touchpoint still schedules a follow-up.
 */
export function cadenceFor(outcomeKey: string | null | undefined): CadenceRule | null {
  if (outcomeKey && NO_CADENCE_OUTCOMES.has(outcomeKey)) return null;
  if (!outcomeKey) return DEFAULT_CADENCE;
  return CADENCE_BY_OUTCOME[outcomeKey] ?? DEFAULT_CADENCE;
}

/** The Date the next touch is due for an outcome, measured from `base` (default now). */
export function cadenceDueDate(
  outcomeKey: string | null | undefined,
  base: Date = new Date(),
): Date | null {
  const rule = cadenceFor(outcomeKey);
  if (!rule) return null;
  const d = new Date(base);
  d.setDate(d.getDate() + rule.days);
  return d;
}

/** `YYYY-MM-DD` for a Date, suitable for an <input type="date"> value. */
export function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The next-touch due date as a `YYYY-MM-DD` string, or null for terminal outcomes. */
export function cadenceDueDateString(
  outcomeKey: string | null | undefined,
  base: Date = new Date(),
): string | null {
  const d = cadenceDueDate(outcomeKey, base);
  return d ? toDateInputValue(d) : null;
}

/** Short display like "Jul 27" for a next-touch confirmation. */
export function formatNextTouch(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
