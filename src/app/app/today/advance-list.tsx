"use client";

import { useMemo, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

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
};

type Props = {
  userId: string;
  nextActions: NextAction[];
  contactsById: Map<string, Contact>;
  accountsById: Map<string, Account>;
  outreachTypes: TouchpointType[];
  outcomes: Outcome[];
  onActionCompleted: () => void;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function plusDaysIso(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function startOfDay(d: Date) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

function formatDueDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
  onActionCompleted,
}: Props) {
  const supabase = useMemo(() => createBrowserSupabase(), []);

  // ── Card expansion ──
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Snooze confirmation ──
  const [snoozeConfirmId, setSnoozeConfirmId] = useState<string | null>(null);

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
      setSnoozeConfirmId(null);
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

  // ── Snooze ──
  async function onSnooze(action: NextAction) {
    setBusyId(`snooze-${action.id}`);

    const { error: updateErr } = await supabase
      .from("next_actions")
      .update({ due_at: plusDaysIso(action.due_at, 1) })
      .eq("id", action.id)
      .eq("assigned_user_id", userId)
      .eq("status", "open");

    setBusyId(null);

    if (updateErr) {
      setFormError(updateErr.message);
      return;
    }

    setSnoozeConfirmId(null);
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
        const due = new Date(action.due_at);
        const isOverdue = due < today;
        const isDueToday = due >= today && due < tomorrow;
        const isExpanded = expandedId === action.id;
        const isSnoozeConfirm = snoozeConfirmId === action.id;

        const contact = action.contact_id ? contactsById.get(action.contact_id) : null;
        const account = action.account_id ? accountsById.get(action.account_id) : null;
        const recommendedType = action.recommended_touchpoint_type_id
          ? outreachTypes.find((t) => t.id === action.recommended_touchpoint_type_id)
          : null;

        const filteredOutcomes = getOutcomesForType(formTypeId);

        return (
          <div
            key={action.id}
            className={[
              "rounded-2xl border shadow-sm transition-colors",
              isOverdue
                ? "border-amber-300 bg-amber-50"
                : "border-slate-200 bg-white",
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
                  {isOverdue && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                      Overdue
                    </span>
                  )}
                  {!isOverdue && isDueToday && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      Today
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500">
                  {account?.name ?? ""}
                  {recommendedType ? ` · ${recommendedType.name}` : ""}
                </div>
                <div className="text-xs text-slate-400">Due {formatDueDate(action.due_at)}</div>
                {action.notes && (
                  <div className="truncate text-xs text-slate-600">{action.notes}</div>
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
                {isSnoozeConfirm ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-700">Snooze 1 day?</span>
                    <button
                      type="button"
                      disabled={busyId === `snooze-${action.id}`}
                      onClick={() => void onSnooze(action)}
                      className="rounded-xl bg-slate-700 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {busyId === `snooze-${action.id}` ? "Snoozing..." : "Yes, snooze"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSnoozeConfirmId(null)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                    >
                      Never mind
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
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
                      onClick={() => setSnoozeConfirmId(action.id)}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Snooze 1 day
                    </button>
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
