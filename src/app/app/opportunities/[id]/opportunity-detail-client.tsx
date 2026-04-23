"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { OppMilestone, OppAssignment } from "@/app/app/opportunities/[id]/page";

type Opportunity = {
  id: string;
  title: string | null;
  status: string;
  estimated_value: number | null;
  bid_value: number | null;
  final_value: number | null;
  stage_id: string;
  scope_type_id: string | null;
  property_id: string | null;
  account_id: string | null;
  primary_contact_id: string | null;
  opened_at: string;
  closed_at: string | null;
  lost_reason_type_id: string | null;
  lost_notes: string | null;
};

type Property = {
  id: string;
  name: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
} | null;

type Account = { id: string; name: string | null; account_type: string | null } | null;
type Contact = { id: string; full_name: string | null; title: string | null; phone: string | null; email: string | null } | null;

type Stage = {
  id: string;
  name: string;
  key: string;
  sort_order: number;
  is_closed_stage: boolean;
};

type ScopeType = { id: string; name: string; key: string };
type LostReason = { id: string; name: string; key: string };
type MilestoneType = { id: string; name: string; key: string };
type OrgUser = { user_id: string; role: string };

type Props = {
  opportunity: Opportunity;
  property: Property;
  account: Account;
  contact: Contact;
  milestones: OppMilestone[];
  stages: Stage[];
  scopeTypes: ScopeType[];
  lostReasons: LostReason[];
  milestoneTypes: MilestoneType[];
  assignments: OppAssignment[];
  orgUsers: OrgUser[];
  orgId: string;
  userId: string;
  userRole: string;
};

const STAGE_TO_MILESTONE: Record<string, string> = {
  inspection_scheduled: "inspection_scheduled",
  inspection_completed: "inspection_completed",
  bid_submitted: "bid_submitted",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-green-100 text-green-800",
  won: "bg-blue-100 text-blue-800",
  lost: "bg-slate-100 text-slate-600",
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function daysOpen(openedAt: string) {
  return Math.floor((Date.now() - new Date(openedAt).getTime()) / 86400000);
}

export default function OpportunityDetailClient({
  opportunity: initOpp,
  property,
  account,
  contact,
  milestones: initMilestones,
  stages,
  scopeTypes,
  lostReasons,
  milestoneTypes,
  assignments,
  orgUsers,
  orgId,
}: Props) {
  const [opportunity, setOpportunity] = useState<Opportunity>(initOpp);
  const [milestones, setMilestones] = useState<OppMilestone[]>(initMilestones);
  const [tab, setTab] = useState<"milestones" | "contacts" | "reps">("milestones");
  const [showLostForm, setShowLostForm] = useState(false);
  const [lostReasonId, setLostReasonId] = useState("");
  const [lostNotes, setLostNotes] = useState("");
  const [lostBusy, setLostBusy] = useState(false);
  const [lostError, setLostError] = useState<string | null>(null);
  const [advanceBusy, setAdvanceBusy] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const supabase = createBrowserSupabase();

  const scopeTypeMap = useMemo(() => new Map(scopeTypes.map((s) => [s.id, s])), [scopeTypes]);
  const orgUserMap = useMemo(() => new Map(orgUsers.map((u) => [u.user_id, u])), [orgUsers]);
  const lostReasonMap = useMemo(() => new Map(lostReasons.map((r) => [r.id, r])), [lostReasons]);

  const openStages = useMemo(() => stages.filter((s) => !s.is_closed_stage), [stages]);
  const wonStage = useMemo(() => stages.find((s) => s.key === "won"), [stages]);
  const lostStage = useMemo(() => stages.find((s) => s.key === "lost"), [stages]);

  const currentStageIndex = useMemo(
    () => openStages.findIndex((s) => s.id === opportunity.stage_id),
    [openStages, opportunity.stage_id],
  );

  const scope = opportunity.scope_type_id ? scopeTypeMap.get(opportunity.scope_type_id) : null;
  const lostReason = opportunity.lost_reason_type_id
    ? lostReasonMap.get(opportunity.lost_reason_type_id)
    : null;

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function advanceToStage(newStageId: string) {
    if (advanceBusy) return;
    setAdvanceBusy(true);
    setAdvanceError(null);

    const { error } = await supabase
      .from("opportunities")
      .update({ stage_id: newStageId })
      .eq("id", opportunity.id);

    if (error) {
      setAdvanceError(error.message);
      setAdvanceBusy(false);
      return;
    }

    // Log milestone if this stage has a milestone mapping
    const newStage = stages.find((s) => s.id === newStageId);
    const milestoneKey = newStage?.key ? STAGE_TO_MILESTONE[newStage.key] : null;
    if (milestoneKey) {
      const mt = milestoneTypes.find((m) => m.key === milestoneKey);
      if (mt) {
        const { data: ms } = await supabase
          .from("opportunity_milestones")
          .insert({ org_id: orgId, opportunity_id: opportunity.id, milestone_type_id: mt.id })
          .select("id,happened_at,notes,milestone_type_id")
          .single();
        if (ms) {
          setMilestones((prev) => [
            {
              id: ms.id as string,
              happened_at: ms.happened_at as string,
              notes: ms.notes as string | null,
              milestone_type_id: ms.milestone_type_id as string,
              milestone_types: mt,
            },
            ...prev,
          ]);
        }
      }
    }

    setOpportunity((prev) => ({ ...prev, stage_id: newStageId }));
    setAdvanceBusy(false);
    showToast("Stage updated.");
  }

  async function handleMarkWon() {
    setAdvanceBusy(true);
    const closedAt = new Date().toISOString();
    const { error } = await supabase
      .from("opportunities")
      .update({
        status: "won",
        stage_id: wonStage?.id ?? opportunity.stage_id,
        closed_at: closedAt,
      })
      .eq("id", opportunity.id);
    setAdvanceBusy(false);
    if (error) { setAdvanceError(error.message); return; }
    setOpportunity((prev) => ({ ...prev, status: "won", stage_id: wonStage?.id ?? prev.stage_id, closed_at: closedAt }));
    showToast("Marked as Won!");
  }

  async function handleMarkLost(e: React.FormEvent) {
    e.preventDefault();
    if (!lostReasonId) { setLostError("Please select a reason."); return; }
    setLostBusy(true);
    setLostError(null);
    const closedAt = new Date().toISOString();
    const { error } = await supabase
      .from("opportunities")
      .update({
        status: "lost",
        stage_id: lostStage?.id ?? opportunity.stage_id,
        closed_at: closedAt,
        lost_reason_type_id: lostReasonId,
        lost_notes: lostNotes.trim() || null,
      })
      .eq("id", opportunity.id);
    setLostBusy(false);
    if (error) { setLostError(error.message); return; }
    setOpportunity((prev) => ({
      ...prev,
      status: "lost",
      stage_id: lostStage?.id ?? prev.stage_id,
      closed_at: closedAt,
      lost_reason_type_id: lostReasonId,
      lost_notes: lostNotes.trim() || null,
    }));
    setShowLostForm(false);
    showToast("Marked as Lost.");
  }

  const propertyAddress = property
    ? (() => {
        const addr = [property.address_line1, property.city, property.state].filter(Boolean).join(", ");
        if (property.name && property.name !== property.address_line1) return `${property.name} — ${addr}`;
        return addr;
      })()
    : null;

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      {/* Back link */}
      <Link href="/app/opportunities" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        ← Opportunities
      </Link>

      {/* Header card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {scope && <span className="font-semibold text-slate-900">{scope.name}</span>}
              {opportunity.title && (
                <span className="text-slate-500">— {opportunity.title}</span>
              )}
            </div>
            {propertyAddress && (
              <Link
                href={`/app/properties/${property!.id}`}
                className="mt-1 block text-sm text-blue-600 hover:underline"
              >
                {propertyAddress}
              </Link>
            )}
            {account && (
              <Link
                href={`/app/accounts/${account.id}`}
                className="mt-0.5 block text-sm text-blue-600 hover:underline"
              >
                {account.name}
              </Link>
            )}
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_COLORS[opportunity.status] ?? ""}`}
          >
            {opportunity.status}
          </span>
        </div>

        {/* Value + dates */}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
          {opportunity.estimated_value != null && (
            <span>Est. {money.format(opportunity.estimated_value)}</span>
          )}
          {opportunity.bid_value != null && (
            <span>Bid {money.format(opportunity.bid_value)}</span>
          )}
          {opportunity.status === "open" && (
            <span>Opened {new Date(opportunity.opened_at).toLocaleDateString()} ({daysOpen(opportunity.opened_at)} days)</span>
          )}
          {opportunity.status === "won" && opportunity.closed_at && (
            <span className="text-blue-700">
              Won {new Date(opportunity.closed_at).toLocaleDateString()}
              {opportunity.final_value != null && ` · ${money.format(opportunity.final_value)} final`}
            </span>
          )}
          {opportunity.status === "lost" && opportunity.closed_at && (
            <span className="text-slate-500">
              Lost {new Date(opportunity.closed_at).toLocaleDateString()}
              {lostReason && ` · Reason: ${lostReason.name}`}
            </span>
          )}
        </div>
      </div>

      {/* Stage progression (only for open opps) */}
      {opportunity.status === "open" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">Pipeline Stage</div>
          <div className="flex flex-wrap gap-2">
            {openStages.map((s, idx) => {
              const isCurrent = s.id === opportunity.stage_id;
              const isPast = idx < currentStageIndex;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={advanceBusy || isCurrent}
                  onClick={() => advanceToStage(s.id)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    isCurrent
                      ? "bg-blue-600 text-white"
                      : isPast
                        ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        : "border border-slate-300 text-slate-500 hover:bg-slate-50"
                  } disabled:cursor-default`}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
          {advanceError && <p className="mt-2 text-sm text-red-600">{advanceError}</p>}

          {/* Won / Lost actions */}
          <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled={advanceBusy}
              onClick={handleMarkWon}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Mark Won
            </button>
            <button
              type="button"
              onClick={() => setShowLostForm((v) => !v)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Mark Lost
            </button>
          </div>

          {/* Lost form */}
          {showLostForm && (
            <form onSubmit={handleMarkLost} className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4">
              <div className="text-sm font-medium text-slate-700">Why did this opportunity fall through?</div>
              <div className="flex flex-wrap gap-2">
                {lostReasons.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setLostReasonId(r.id)}
                    className={`rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${
                      lostReasonId === r.id
                        ? "bg-slate-900 text-white"
                        : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
              <textarea
                value={lostNotes}
                onChange={(e) => setLostNotes(e.target.value)}
                placeholder="Additional notes (optional)"
                rows={2}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
              {lostError && <p className="text-sm text-red-600">{lostError}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={lostBusy}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {lostBusy ? "Saving…" : "Confirm Lost"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowLostForm(false); setLostReasonId(""); setLostNotes(""); setLostError(null); }}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex border-b border-slate-200">
          {(["milestones", "contacts", "reps"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium capitalize transition-colors ${
                tab === t
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="p-4">
          {/* Milestones tab */}
          {tab === "milestones" && (
            <>
              {milestones.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No milestones logged yet. Advance the stage to log pipeline events.
                </p>
              ) : (
                <div className="space-y-3">
                  {milestones.map((m) => (
                    <div key={m.id} className="flex items-start gap-3">
                      <div className="mt-0.5 size-2 shrink-0 rounded-full bg-blue-500" />
                      <div>
                        <div className="text-sm font-medium text-slate-900">
                          {m.milestone_types?.name ?? "Milestone"}
                        </div>
                        <div className="text-xs text-slate-500">
                          {new Date(m.happened_at).toLocaleDateString("en-US", {
                            month: "short", day: "numeric", year: "numeric",
                          })}
                        </div>
                        {m.notes && <div className="mt-0.5 text-xs text-slate-600">{m.notes}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Contacts tab */}
          {tab === "contacts" && (
            <>
              {!contact ? (
                <p className="text-sm text-slate-500">No primary contact assigned to this opportunity.</p>
              ) : (
                <div className="rounded-xl border border-slate-200 p-3">
                  <Link
                    href={`/app/contacts/${contact.id}`}
                    className="font-medium text-blue-600 hover:underline"
                  >
                    {contact.full_name ?? "Unnamed Contact"}
                  </Link>
                  {contact.title && <div className="mt-0.5 text-sm text-slate-500">{contact.title}</div>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {contact.phone && (
                      <a href={`tel:${contact.phone}`} className="text-xs text-slate-600 hover:underline">
                        {contact.phone}
                      </a>
                    )}
                    {contact.email && (
                      <a href={`mailto:${contact.email}`} className="text-xs text-slate-600 hover:underline">
                        {contact.email}
                      </a>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Reps tab */}
          {tab === "reps" && (
            <>
              {assignments.length === 0 ? (
                <p className="text-sm text-slate-500">No reps assigned to this opportunity.</p>
              ) : (
                <div className="space-y-2">
                  {assignments.map((a) => {
                    const user = orgUserMap.get(a.user_id);
                    return (
                      <div key={a.user_id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                        <div>
                          <div className="text-sm font-medium text-slate-900">
                            {user ? `${a.user_id.slice(0, 8)}…` : a.user_id.slice(0, 8) + "…"}
                          </div>
                          <div className="text-xs capitalize text-slate-500">
                            {a.assignment_role.replace(/_/g, " ")}
                          </div>
                        </div>
                        {a.is_primary && (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                            Primary Rep
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
