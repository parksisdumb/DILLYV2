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

// ── Types ──────────────────────────────────────────────────────────────────

type Account = { id: string; name: string | null };
type Contact = { id: string; full_name: string | null; account_id: string };
type TouchpointType = { id: string; name: string; key?: string | null; is_outreach: boolean };
type Outcome = { id: string; name: string; touchpoint_type_id?: string | null };

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
  nextActions: NextAction[];
  contactsById: Map<string, Contact>;
  accountsById: Map<string, Account>;
  outreachTypes: TouchpointType[];
  outcomes: Outcome[];
  latestTouchpointByContactId: Map<string, LatestTouchpoint>;
  sourceTouchpointOutcomeByActionId: Map<string, string | null>;
  onActionCompleted: () => void;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function startOfDay(d: Date) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

function formatDueDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

  const outcomeNameById = useMemo(
    () => new Map(outcomes.map((o) => [o.id, o.name])),
    [outcomes],
  );

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

  const today = startOfDay(new Date());
  const tomorrow = startOfDay(new Date(today.getTime() + 86_400_000));

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
    }
  }

  // ── Outcome filtering (same pattern as GrowForm) ──
  function getOutcomesForType(typeId: string): Outcome[] {
    if (!typeId) return [];
    const typeSpecific = outcomes.filter((o) => o.touchpoint_type_id === typeId);
    return typeSpecific.length > 0 ? typeSpecific : outcomes;
  }

  // ── Log & Complete ──
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

    const { data: rpcData, error: rpcErr } = await supabase.rpc(
      "rpc_log_outreach_touchpoint",
      {
        p_contact_id: action.contact_id,
        p_account_id: action.account_id,
        p_touchpoint_type_id: formTypeId,
        p_property_id: action.property_id ?? null,
        p_outcome_id: formOutcomeId || null,
        p_notes: formNotes.trim(),
        p_engagement_phase: "follow_up",
      },
    );

    if (rpcErr) {
      setFormError(rpcErr.message);
      setBusyId(null);
      return;
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    const touchpointId = row?.touchpoint_id as string | undefined;

    // Mark next_action completed
    const { error: updateErr } = await supabase
      .from("next_actions")
      .update({
        status: "completed",
        ...(touchpointId ? { completed_by_touchpoint_id: touchpointId } : {}),
      })
      .eq("id", action.id)
      .eq("assigned_user_id", userId)
      .eq("status", "open");

    setBusyId(null);

    if (updateErr) {
      setFormError(updateErr.message);
      return;
    }

    setExpandedId(null);
    onActionCompleted();
  }

  // ── Snooze — legitimate rescheduling, not failure. Rolls forward from today,
  //    bumps snoozed_count, records last_snoozed_at. Degrades to a plain due_at
  //    update if the snooze columns aren't in the DB yet. ──
  async function onSnooze(action: NextAction, dueIso: string) {
    setBusyId(`snooze-${action.id}`);

    const where = (payload: Record<string, unknown>) =>
      supabase
        .from("next_actions")
        .update(payload)
        .eq("id", action.id)
        .eq("assigned_user_id", userId)
        .eq("status", "open");

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

  // ── Dismiss with a reason — close without completing (better than snoozing
  //    forever). Stores dismiss_reason when the column exists. ──
  async function onDismiss(action: NextAction, reasonKey: string) {
    setBusyId(`dismiss-${action.id}`);

    const where = (payload: Record<string, unknown>) =>
      supabase
        .from("next_actions")
        .update(payload)
        .eq("id", action.id)
        .eq("assigned_user_id", userId)
        .eq("status", "open");

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

  // ── Empty state ──
  if (nextActions.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="text-3xl text-emerald-500">✓</div>
        <div className="mt-2 text-base font-semibold text-slate-700">All caught up!</div>
        <div className="mt-1 text-sm text-slate-500">
          Your follow-up queue is clear. Keep the momentum going.
        </div>
      </div>
    );
  }

  // ── List ──
  return (
    <div className="space-y-3">
      {nextActions.map((action) => {
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

        return (
          <div
            key={action.id}
            className={[
              "rounded-2xl border shadow-sm transition-colors",
              tierStyle ? tierStyle.card : "border-slate-200 bg-white",
            ].join(" ")}
          >
            {/* ── Card header (always visible, tap to expand) ── */}
            <button
              type="button"
              onClick={() => toggleExpand(action.id)}
              className="flex w-full items-start justify-between px-4 py-3.5 text-left"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">
                    {contact?.full_name || "Unknown contact"}
                  </span>
                  {tierStyle && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tierStyle.badge}`}>
                      {odDays} day{odDays === 1 ? "" : "s"} overdue
                    </span>
                  )}
                  {isDueToday && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      Today
                    </span>
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
                {/* Outreach context: last touchpoint or first-touch pill */}
                {latestTp && latestTpDays !== null ? (
                  <div className="text-xs">
                    <span className={`font-medium ${daysAgoColor(latestTpDays)}`}>
                      {daysAgoLabel(latestTpDays)}
                    </span>
                    {latestTpOutcome && (
                      <span className="text-slate-500"> · {latestTpOutcome}</span>
                    )}
                  </div>
                ) : (
                  <div>
                    <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      First touch
                    </span>
                  </div>
                )}
                {sourceOutcomeName && (
                  <div className="text-xs text-slate-500">
                    Following up on: <span className="text-slate-700">{sourceOutcomeName}</span>
                  </div>
                )}
                <div className="text-xs text-slate-400">Due {formatDueDate(action.due_at)}</div>
                {action.notes && (
                  <div className="truncate text-xs italic text-slate-600">{action.notes}</div>
                )}
              </div>
              <svg
                className={[
                  "ml-2 mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform",
                  isExpanded ? "rotate-180" : "",
                ].join(" ")}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* ── Expanded: Log & Complete form ── */}
            {isExpanded && (
              <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Log & Complete
                </div>

                {formError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {formError}
                  </div>
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
                        setFormError(null);
                      }}
                      className={chipBtn(formTypeId === t.id)}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>

                {/* Outcome chips */}
                {formTypeId && filteredOutcomes.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {filteredOutcomes.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() =>
                          setFormOutcomeId(formOutcomeId === o.id ? "" : o.id)
                        }
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

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === `complete-${action.id}`}
                    onClick={() => void onComplete(action)}
                    className={[
                      "rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
                      formTypeId && formNotes.trim()
                        ? "bg-blue-600 text-white hover:bg-blue-700"
                        : "bg-slate-100 text-slate-400",
                    ].join(" ")}
                  >
                    {busyId === `complete-${action.id}` ? "Logging..." : "Log & Complete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActionMenu(actionMenu === "snooze" ? "none" : "snooze")}
                    className={chipBtn(actionMenu === "snooze")}
                  >
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
      })}
    </div>
  );
}
