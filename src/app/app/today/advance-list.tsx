"use client";

import { useMemo, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import {
  daysOverdue,
  overdueTier,
  OVERDUE_TIER_STYLES,
  isChronicSnooze,
  SNOOZE_PRESETS,
  snoozeDueDate,
  dateInputToDueIso,
  DISMISS_REASONS,
  isMissingColumnError,
} from "@/lib/overdue";
import { startOfTodayUtc, startOfTomorrowUtc } from "@/lib/time";
import { formatNextTouch } from "@/lib/constants/cadence";
import { useCadenceFollowUp, CadenceFollowUpFields } from "@/app/app/_components/cadence-follow-up";

// ── Types ──────────────────────────────────────────────────────────────────

type Account = { id: string; name: string | null };
type Contact = { id: string; full_name: string | null; account_id: string; phone?: string | null };
type TouchpointType = { id: string; name: string; key?: string | null; is_outreach: boolean };
type Outcome = { id: string; name: string; touchpoint_type_id?: string | null; key?: string | null };

type NextAction = {
  id: string;
  property_id: string | null;
  contact_id: string | null;
  account_id: string | null;
  opportunity_id: string | null;
  due_at: string;
  notes: string | null;
  recommended_touchpoint_type_id: string | null;
  created_from_touchpoint_id: string | null;
  snoozed_count?: number | null;
  last_snoozed_at?: string | null;
};

type LatestTouchpoint = { happened_at: string; outcome_id: string | null };

type Props = {
  userId: string;
  orgId: string;
  nextActions: NextAction[];
  contactsById: Map<string, Contact>;
  accountsById: Map<string, Account>;
  outreachTypes: TouchpointType[];
  outcomes: Outcome[];
  latestTouchpointByContactId: Map<string, LatestTouchpoint>;
  sourceTouchpointOutcomeByActionId: Map<string, string | null>;
  onActionCompleted: (message?: string) => void;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDueDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dayHeading(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function daysAgoLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function daysAgoColor(days: number): string {
  if (days <= 3) return "text-emerald-600";
  if (days <= 14) return "text-amber-600";
  return "text-red-600";
}

const chipBtn = (active: boolean) =>
  [
    "rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
    active
      ? "border-blue-600 bg-blue-600 text-white"
      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
  ].join(" ");

const input =
  "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none";

// ── Component ──────────────────────────────────────────────────────────────

export default function AdvanceList({
  userId,
  orgId,
  nextActions,
  contactsById,
  accountsById,
  outreachTypes,
  outcomes,
  latestTouchpointByContactId,
  sourceTouchpointOutcomeByActionId,
  onActionCompleted,
}: Props) {
  const supabase = useMemo(() => createBrowserSupabase(), []);

  const outcomeNameById = useMemo(() => new Map(outcomes.map((o) => [o.id, o.name])), [outcomes]);
  const outcomeKeyById = useMemo(() => new Map(outcomes.map((o) => [o.id, o.key ?? null])), [outcomes]);

  // ── Card expansion ──
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Per-card action menu (snooze presets / dismiss reasons) ──
  const [actionMenu, setActionMenu] = useState<"none" | "snooze" | "dismiss">("none");
  const [pickDate, setPickDate] = useState("");

  // ── Busy state ──
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── Log & Complete form state (shared, reset on card change) ──
  const [formTypeId, setFormTypeId] = useState("");
  const [formOutcomeId, setFormOutcomeId] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // ── Continuous-chain cadence: same engine Grow uses. Picking an outcome
  //    pre-fills the next touch (default ON); completing schedules it. ──
  const fu = useCadenceFollowUp();

  // ── Upcoming section collapse ──
  const [upcomingOpen, setUpcomingOpen] = useState(false);

  const today = new Date(startOfTodayUtc());
  const tomorrow = new Date(startOfTomorrowUtc());
  const upcomingEnd = useMemo(() => {
    const d = new Date(tomorrow);
    d.setDate(d.getDate() + 7); // tomorrow through 7 days out
    return d;
  }, [tomorrow]);

  // Partition the queue: what needs doing now vs. what's simply scheduled.
  const { active, upcoming, later } = useMemo(() => {
    const active: NextAction[] = [];
    const upcoming: NextAction[] = [];
    const later: NextAction[] = [];
    for (const a of nextActions) {
      const due = new Date(a.due_at);
      if (due < tomorrow) active.push(a);
      else if (due < upcomingEnd) upcoming.push(a);
      else later.push(a);
    }
    return { active, upcoming, later };
  }, [nextActions, tomorrow, upcomingEnd]);

  // ── Expand / collapse a card ──
  function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      setFormTypeId("");
      setFormOutcomeId("");
      setFormNotes("");
      setFormError(null);
      setActionMenu("none");
      setPickDate("");
      fu.reset();
    }
  }

  // ── Outcome filtering (same pattern as GrowForm) ──
  function getOutcomesForType(typeId: string): Outcome[] {
    if (!typeId) return [];
    const typeSpecific = outcomes.filter((o) => o.touchpoint_type_id === typeId);
    return typeSpecific.length > 0 ? typeSpecific : outcomes;
  }

  // ── Log & Complete → schedule the NEXT touch (continuous chain) ──
  async function onComplete(action: NextAction) {
    if (!formTypeId) {
      setFormError("Select how you reached out.");
      return;
    }
    if (!formNotes.trim()) {
      setFormError("Notes are required.");
      return;
    }
    if (!action.contact_id || !action.account_id) {
      setFormError("This action is missing contact or account data.");
      return;
    }

    setFormError(null);
    setBusyId(`complete-${action.id}`);

    const { data: rpcData, error: rpcErr } = await supabase.rpc("rpc_log_outreach_touchpoint", {
      p_contact_id: action.contact_id,
      p_account_id: action.account_id,
      p_touchpoint_type_id: formTypeId,
      p_property_id: action.property_id ?? null,
      p_outcome_id: formOutcomeId || null,
      p_notes: formNotes.trim(),
      // engagement_phase is derived server-side.
    });

    if (rpcErr) {
      setFormError(rpcErr.message);
      setBusyId(null);
      return;
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    const touchpointId = (row?.touchpoint_id as string | undefined) ?? null;

    // 1) Complete the CURRENT action first — then create the next, so the chain
    //    never leaves two open links for one completion (guards double-create).
    const { error: updateErr } = await supabase
      .from("next_actions")
      .update({
        status: "completed",
        ...(touchpointId ? { completed_by_touchpoint_id: touchpointId } : {}),
      })
      .eq("id", action.id)
      .eq("assigned_user_id", userId)
      .eq("status", "open");

    if (updateErr) {
      setBusyId(null);
      setFormError(updateErr.message);
      return;
    }

    // 2) Schedule the next touch via the cadence engine (default ON; the rep may
    //    have toggled it off or edited the date). Linked to the touchpoint just
    //    logged, so the chain is traceable.
    let nextMsg = "Completed";
    const followUpRow = fu.buildInsert({
      orgId,
      userId,
      contactId: action.contact_id,
      accountId: action.account_id,
      propertyId: action.property_id ?? null,
      typeId: formTypeId,
      touchpointId,
      fallbackNote: "Follow up",
    });
    if (followUpRow) {
      const { error: insErr } = await supabase.from("next_actions").insert(followUpRow);
      if (insErr) {
        // The current action IS completed; surface that the next link failed so it
        // isn't silently dropped (the exact bug this fix exists to prevent).
        setBusyId(null);
        setFormError(`Logged, but scheduling the next touch failed: ${insErr.message}`);
        onActionCompleted();
        return;
      }
      nextMsg = `Next touch ${formatNextTouch(new Date(`${fu.date}T00:00:00`))}`;
    }

    setBusyId(null);
    setExpandedId(null);
    onActionCompleted(nextMsg);
  }

  // ── Snooze — legitimate rescheduling, not failure. ──
  async function onSnooze(action: NextAction, dueIso: string) {
    setBusyId(`snooze-${action.id}`);
    const where = (payload: Record<string, unknown>) =>
      supabase.from("next_actions").update(payload).eq("id", action.id).eq("assigned_user_id", userId).eq("status", "open");

    let { error } = await where({
      due_at: dueIso,
      snoozed_count: (action.snoozed_count ?? 0) + 1,
      last_snoozed_at: new Date().toISOString(),
    });
    if (error && isMissingColumnError(error)) {
      ({ error } = await where({ due_at: dueIso }));
    }

    setBusyId(null);
    if (error) {
      setFormError(error.message);
      return;
    }
    setActionMenu("none");
    setExpandedId(null);
    onActionCompleted();
  }

  // ── Dismiss with a reason — the only thing that ENDS the chain. ──
  async function onDismiss(action: NextAction, reasonKey: string) {
    setBusyId(`dismiss-${action.id}`);
    const where = (payload: Record<string, unknown>) =>
      supabase.from("next_actions").update(payload).eq("id", action.id).eq("assigned_user_id", userId).eq("status", "open");

    let { error } = await where({ status: "dismissed", dismiss_reason: reasonKey });
    if (error && isMissingColumnError(error)) {
      ({ error } = await where({ status: "dismissed" }));
    }

    setBusyId(null);
    if (error) {
      setFormError(error.message);
      return;
    }
    setActionMenu("none");
    setExpandedId(null);
    onActionCompleted();
  }

  // ── Active card renderer (overdue + due today) ──
  function renderCard(action: NextAction) {
    const odDays = daysOverdue(action.due_at);
    const tier = overdueTier(action.due_at);
    const tierStyle = tier !== "none" ? OVERDUE_TIER_STYLES[tier] : null;
    const chronic = isChronicSnooze(action.snoozed_count);
    const due = new Date(action.due_at);
    const isDueToday = tier === "none" && due >= today && due < tomorrow;
    const isExpanded = expandedId === action.id;

    const contact = action.contact_id ? contactsById.get(action.contact_id) : null;
    const account = action.account_id ? accountsById.get(action.account_id) : null;
    const recommendedType = action.recommended_touchpoint_type_id
      ? outreachTypes.find((t) => t.id === action.recommended_touchpoint_type_id)
      : null;

    const latestTp = action.contact_id ? latestTouchpointByContactId.get(action.contact_id) : null;
    const latestTpDays = latestTp ? daysSince(latestTp.happened_at) : null;
    const latestTpOutcome = latestTp?.outcome_id ? outcomeNameById.get(latestTp.outcome_id) ?? null : null;

    const sourceOutcomeId = sourceTouchpointOutcomeByActionId.get(action.id) ?? null;
    const sourceOutcomeName = sourceOutcomeId ? outcomeNameById.get(sourceOutcomeId) ?? null : null;

    const filteredOutcomes = getOutcomesForType(formTypeId);
    const phone = contact?.phone?.trim() || null;

    return (
      <div
        key={action.id}
        className={["rounded-2xl border shadow-sm transition-colors", tierStyle ? tierStyle.card : "border-slate-200 bg-white"].join(" ")}
      >
        {/* ── Card header (tap to expand) + tap-to-call ── */}
        <div className="flex items-start">
          <button
            type="button"
            onClick={() => toggleExpand(action.id)}
            className="flex min-w-0 flex-1 items-start justify-between px-4 py-3.5 text-left"
          >
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">{contact?.full_name || "Unknown contact"}</span>
                {tierStyle && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tierStyle.badge}`}>
                    {odDays} day{odDays === 1 ? "" : "s"} overdue
                  </span>
                )}
                {isDueToday && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Today</span>
                )}
                {chronic && (
                  <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">
                    Snoozed {action.snoozed_count} times
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500">
                {account?.name ?? ""}
                {recommendedType ? ` · ${recommendedType.name}` : ""}
              </div>
              {latestTp && latestTpDays !== null ? (
                <div className="text-xs">
                  <span className={`font-medium ${daysAgoColor(latestTpDays)}`}>{daysAgoLabel(latestTpDays)}</span>
                  {latestTpOutcome && <span className="text-slate-500"> · {latestTpOutcome}</span>}
                </div>
              ) : (
                <div>
                  <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">First touch</span>
                </div>
              )}
              {sourceOutcomeName && (
                <div className="text-xs text-slate-500">
                  Following up on: <span className="text-slate-700">{sourceOutcomeName}</span>
                </div>
              )}
              <div className="text-xs text-slate-400">Due {formatDueDate(action.due_at)}</div>
              {action.notes && <div className="truncate text-xs italic text-slate-600">{action.notes}</div>}
            </div>
            <svg
              className={["ml-2 mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform", isExpanded ? "rotate-180" : ""].join(" ")}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {phone && (
            <a
              href={`tel:${phone}`}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Call ${contact?.full_name ?? "contact"}`}
              className="mr-3 mt-3.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M2 3.5A1.5 1.5 0 013.5 2h1.148a1.5 1.5 0 011.465 1.175l.716 3.223a1.5 1.5 0 01-1.052 1.767l-.933.267c-.41.117-.643.555-.48.95a11.542 11.542 0 006.254 6.254c.395.163.833-.07.95-.48l.267-.933a1.5 1.5 0 011.767-1.052l3.223.716A1.5 1.5 0 0118 15.352V16.5a1.5 1.5 0 01-1.5 1.5H15c-8.284 0-15-6.716-15-15V3.5z" />
              </svg>
            </a>
          )}
        </div>

        {/* ── Expanded: Log & Complete + schedule next ── */}
        {isExpanded && (
          <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Log &amp; Complete</div>

            {formError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{formError}</div>
            )}

            {/* Outreach type chips */}
            <div className="flex flex-wrap gap-2">
              {outreachTypes.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setFormTypeId(t.id);
                    setFormOutcomeId("");
                    fu.applyOutcome(null);
                    setFormError(null);
                  }}
                  className={chipBtn(formTypeId === t.id)}
                >
                  {t.name}
                </button>
              ))}
            </div>

            {/* Outcome chips → drive the cadence */}
            {formTypeId && filteredOutcomes.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {filteredOutcomes.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      const next = formOutcomeId === o.id ? "" : o.id;
                      setFormOutcomeId(next);
                      fu.applyOutcome(next ? outcomeKeyById.get(o.id) ?? null : null);
                    }}
                    className={chipBtn(formOutcomeId === o.id)}
                  >
                    {o.name}
                  </button>
                ))}
              </div>
            )}

            {/* Notes */}
            <input
              className={input}
              placeholder="What happened? (required)"
              value={formNotes}
              onChange={(e) => {
                setFormNotes(e.target.value);
                setFormError(null);
              }}
            />

            {/* Schedule the next touch — default ON, pre-filled, one tap to adjust */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <CadenceFollowUpFields fu={fu} />
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busyId === `complete-${action.id}`}
                onClick={() => void onComplete(action)}
                className={[
                  "rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
                  formTypeId && formNotes.trim() ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-slate-100 text-slate-400",
                ].join(" ")}
              >
                {busyId === `complete-${action.id}` ? "Logging..." : "Log & Complete"}
              </button>
              <button type="button" onClick={() => setActionMenu(actionMenu === "snooze" ? "none" : "snooze")} className={chipBtn(actionMenu === "snooze")}>
                Snooze
              </button>
              <button
                type="button"
                onClick={() => setActionMenu(actionMenu === "dismiss" ? "none" : "dismiss")}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50"
              >
                Dismiss
              </button>
            </div>

            {/* Snooze presets */}
            {actionMenu === "snooze" && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
                <span className="text-xs font-medium text-slate-500">Snooze until</span>
                {SNOOZE_PRESETS.filter((p) => p.days !== null).map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    disabled={busyId === `snooze-${action.id}`}
                    onClick={() => void onSnooze(action, snoozeDueDate(p.days as number))}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    {p.label}
                  </button>
                ))}
                <input
                  type="date"
                  value={pickDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setPickDate(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-blue-400 focus:outline-none"
                />
                {pickDate && (
                  <button
                    type="button"
                    disabled={busyId === `snooze-${action.id}`}
                    onClick={() => void onSnooze(action, dateInputToDueIso(pickDate))}
                    className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    Snooze
                  </button>
                )}
              </div>
            )}

            {/* Dismiss reasons */}
            {actionMenu === "dismiss" && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
                <span className="text-xs font-medium text-slate-500">Close without completing —</span>
                {DISMISS_REASONS.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    disabled={busyId === `dismiss-${action.id}`}
                    onClick={() => void onDismiss(action, r.key)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Empty state — only when there is genuinely nothing, now or scheduled ──
  if (nextActions.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="text-3xl text-emerald-500">✓</div>
        <div className="mt-2 text-base font-semibold text-slate-700">All caught up!</div>
        <div className="mt-1 text-sm text-slate-500">Your follow-up queue is clear. Keep the momentum going.</div>
      </div>
    );
  }

  // Group upcoming by day for the collapsed schedule.
  const upcomingByDay = new Map<string, NextAction[]>();
  for (const a of upcoming) {
    const key = new Date(a.due_at).toDateString();
    (upcomingByDay.get(key) ?? upcomingByDay.set(key, []).get(key)!).push(a);
  }

  return (
    <div className="space-y-3">
      {/* Active queue: overdue + due today */}
      {active.length > 0 ? (
        active.map(renderCard)
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
          <div className="text-2xl text-emerald-500">✓</div>
          <div className="mt-1 text-sm font-semibold text-slate-700">Nothing due today</div>
          <div className="mt-0.5 text-xs text-slate-500">You&rsquo;re on top of it — upcoming follow-ups are below.</div>
        </div>
      )}

      {/* Upcoming: next 7 days, collapsed by default so the schedule is always visible */}
      {upcoming.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setUpcomingOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              Upcoming
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{upcoming.length}</span>
              <span className="text-xs font-normal text-slate-400">next 7 days</span>
            </span>
            <svg
              className={["h-4 w-4 text-slate-400 transition-transform", upcomingOpen ? "rotate-180" : ""].join(" ")}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {upcomingOpen && (
            <div className="border-t border-slate-100 px-4 py-3 space-y-3">
              {[...upcomingByDay.entries()].map(([dayKey, items]) => (
                <div key={dayKey}>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {dayHeading(items[0].due_at)}
                  </div>
                  <div className="space-y-1.5">
                    {items.map((a) => {
                      const c = a.contact_id ? contactsById.get(a.contact_id) : null;
                      const acc = a.account_id ? accountsById.get(a.account_id) : null;
                      return (
                        <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-slate-800">{c?.full_name || "Unknown contact"}</div>
                            <div className="truncate text-xs text-slate-500">
                              {acc?.name ?? ""}
                              {a.notes ? ` · ${a.notes}` : ""}
                            </div>
                          </div>
                          <span className="shrink-0 text-xs text-slate-400">{formatDueDate(a.due_at)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {later.length > 0 && (
                <div className="pt-1 text-xs text-slate-400">+ {later.length} scheduled further out</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Nothing due and nothing this week, but scheduled further out */}
      {upcoming.length === 0 && later.length > 0 && (
        <div className="text-center text-xs text-slate-400">{later.length} follow-up{later.length === 1 ? "" : "s"} scheduled further out</div>
      )}
    </div>
  );
}
