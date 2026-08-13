// Timezone-aware day boundaries for activity date filtering.
//
// Touchpoints are stored as UTC instants (correct). The bug this fixes: "today /
// yesterday / this week" boundaries were computed on the UTC calendar day, so for
// US orgs an evening touchpoint (logged before midnight local, after midnight UTC)
// bucketed into the wrong day and vanished from "yesterday".
//
// We compute each boundary as a wall-clock day in the app timezone, then convert
// to a UTC instant for the query. DST is handled by luxon (IANA tz database) — we
// never shift by a fixed offset.
//
// There is no per-org timezone column yet; APP_TIME_ZONE is the single default.
// Lift it to an `orgs.timezone` setting later by threading a tz argument through
// these helpers (they already accept one).

import { DateTime } from "luxon";

/** Default app timezone. Central covers the current orgs; make per-org later. */
export const APP_TIME_ZONE = "America/Chicago";

function now(tz: string): DateTime {
  return DateTime.now().setZone(tz);
}

/** Start of today (00:00 in `tz`) as a UTC ISO instant. */
export function startOfTodayUtc(tz: string = APP_TIME_ZONE): string {
  return now(tz).startOf("day").toUTC().toISO()!;
}

/** Start of tomorrow (for end-exclusive [today, tomorrow) ranges) as UTC ISO. */
export function startOfTomorrowUtc(tz: string = APP_TIME_ZONE): string {
  return now(tz).startOf("day").plus({ days: 1 }).toUTC().toISO()!;
}

/** Start of the day N days ago (N=1 → start of yesterday) as UTC ISO. */
export function startOfDaysAgoUtc(n: number, tz: string = APP_TIME_ZONE): string {
  return now(tz).startOf("day").minus({ days: n }).toUTC().toISO()!;
}

/** Start of the current week — Monday 00:00 in `tz` (luxon weeks start Monday) — as UTC ISO. */
export function startOfWeekUtc(tz: string = APP_TIME_ZONE): string {
  return now(tz).startOf("week").toUTC().toISO()!;
}

/** Start of the current month (1st 00:00 in `tz`) as UTC ISO. */
export function startOfMonthUtc(tz: string = APP_TIME_ZONE): string {
  return now(tz).startOf("month").toUTC().toISO()!;
}

/** A picked `YYYY-MM-DD` interpreted as start-of-day in `tz`, as UTC ISO. */
export function dateStartUtc(dateStr: string, tz: string = APP_TIME_ZONE): string {
  return DateTime.fromISO(dateStr, { zone: tz }).startOf("day").toUTC().toISO()!;
}

/** A picked `YYYY-MM-DD` interpreted as end-of-day in `tz`, as UTC ISO. */
export function dateEndUtc(dateStr: string, tz: string = APP_TIME_ZONE): string {
  return DateTime.fromISO(dateStr, { zone: tz }).endOf("day").toUTC().toISO()!;
}

/** Current instant as UTC ISO. */
export function nowUtc(): string {
  return DateTime.now().toUTC().toISO()!;
}

/** Rolling window: exactly N*24h before now (duration-based, tz-independent). */
export function rollingDaysAgoUtc(n: number): string {
  return DateTime.now().minus({ days: n }).toUTC().toISO()!;
}

/**
 * Human "last active" label in the app timezone — so an evening-heavy rep whose
 * "today" count is 0 still reads as recently active, not inactive.
 *   just now · 12m ago · today 9:03 AM · yesterday 8:19 PM · Sat 8:19 PM · Aug 3
 */
export function formatLastActiveCentral(iso: string | null | undefined, tz: string = APP_TIME_ZONE): string {
  if (!iso) return "no recent activity";
  const dt = DateTime.fromISO(iso).setZone(tz);
  if (!dt.isValid) return "no recent activity";
  const nowLocal = DateTime.now().setZone(tz);
  const mins = nowLocal.diff(dt, "minutes").minutes;
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  const dayDiff = Math.round(nowLocal.startOf("day").diff(dt.startOf("day"), "days").days);
  const time = dt.toFormat("h:mm a");
  if (dayDiff <= 0) return `today ${time}`;
  if (dayDiff === 1) return `yesterday ${time}`;
  if (dayDiff < 7) return `${dt.toFormat("ccc")} ${time}`;
  return dt.toFormat("MMM d");
}
