"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { formatPhone } from "@/lib/utils/format";
import type { FocusQueueItem, FocusFollowUpItem, FocusProspectItem } from "./page";

type OutcomeButton = {
  id: string;
  key: string;
  name: string;
  emoji: string;
  label: string;
  points: number;
};

type Props = {
  queue: FocusQueueItem[];
  outcomeButtons: OutcomeButton[];
  callTypeId: string | null;
  outreachToday: number;
  outreachTarget: number;
  streakAtStart: number;
  orgId: string;
  userId: string;
};

type LoggedOutcome = {
  contactKey: string; // contactId for follow_ups, prospectId for prospects
  outcomeKey: string;
  points: number;
};

function fmtTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function daysAgoLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function daysAgoColor(days: number): string {
  if (days <= 3) return "text-emerald-300";
  if (days <= 14) return "text-amber-300";
  return "text-red-300";
}

export default function FocusClient({
  queue: initialQueue,
  outcomeButtons,
  callTypeId,
  outreachToday: outreachAtStart,
  outreachTarget,
  streakAtStart,
  userId,
}: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabase(), []);

  const [queue, setQueue] = useState<FocusQueueItem[]>(initialQueue);
  const [completed, setCompleted] = useState<LoggedOutcome[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Timer
  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => {
      setSecondsElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const currentItem: FocusQueueItem | null = queue[0] ?? null;
  const isComplete = currentItem === null;

  const sessionConnects = completed.filter((c) => c.outcomeKey === "connected_conversation").length;
  const sessionInspections = completed.filter((c) => c.outcomeKey === "inspection_scheduled").length;
  const sessionPoints = completed.reduce((s, c) => s + c.points, 0);

  const callsToward = outreachAtStart + completed.length;
  const targetPct = outreachTarget > 0 ? Math.min(100, Math.round((callsToward / outreachTarget) * 100)) : 0;
  const targetMet = callsToward >= outreachTarget && outreachTarget > 0;

  function showPulse() {
    setPulse(true);
    setTimeout(() => setPulse(false), 500);
  }

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  async function logFollowUpOutcome(item: FocusFollowUpItem, outcome: OutcomeButton): Promise<boolean> {
    const { data, error: rpcErr } = await supabase.rpc("rpc_log_outreach_touchpoint", {
      p_contact_id: item.contactId,
      p_account_id: item.accountId,
      p_touchpoint_type_id: callTypeId,
      p_property_id: item.propertyId ?? null,
      p_outcome_id: outcome.id,
      p_notes: `Focus session · ${outcome.label}`,
      p_engagement_phase: "follow_up",
    });
    if (rpcErr) {
      showToast(`Couldn't log call: ${rpcErr.message}`);
      return false;
    }
    const row = Array.isArray(data) ? data[0] : data;
    const tpId = (row as Record<string, unknown> | null)?.touchpoint_id as string | undefined;
    await supabase
      .from("next_actions")
      .update({
        status: "completed",
        ...(tpId ? { completed_by_touchpoint_id: tpId } : {}),
      })
      .eq("id", item.nextActionId)
      .eq("status", "open");
    return true;
  }

  async function convertProspectAndLog(item: FocusProspectItem, outcome: OutcomeButton): Promise<boolean> {
    // Two-step on purpose. rpc_convert_prospect with p_log_touchpoint=true has a
    // latent bug — its internal `v_result := public.rpc_log_outreach_touchpoint(...)`
    // assigns a record-returning function to a jsonb variable and PG raises
    // "invalid input syntax for type json: Token \"(\" is invalid". Nobody hit
    // it before because the manager prospect-convert flow always passes
    // p_log_touchpoint=false. Until that RPC is patched, convert without the
    // touchpoint, then log it separately.
    const hasContactName = Boolean((item.contactFirstName ?? "").trim() || (item.contactLastName ?? "").trim());
    const { data: convData, error: convErr } = await supabase.rpc("rpc_convert_prospect", {
      p_prospect_id: item.prospectId,
      p_account_name: item.companyName,
      p_account_type: item.accountType,
      p_account_website: item.accountWebsite,
      p_account_phone: item.accountPhone,
      p_account_notes: null,
      p_create_contact: hasContactName,
      p_contact_full_name: null,
      p_contact_first_name: item.contactFirstName,
      p_contact_last_name: item.contactLastName,
      p_contact_title: item.contactTitle,
      p_contact_email: item.contactEmail,
      p_contact_phone: item.contactPhone,
      p_create_property: false,
      p_property_address: null,
      p_property_city: null,
      p_property_state: null,
      p_property_postal_code: null,
      p_log_touchpoint: false,
      p_touchpoint_type_id: null,
      p_touchpoint_outcome_id: null,
      p_touchpoint_notes: null,
    });
    if (convErr) {
      showToast(`Couldn't convert ${item.companyName}: ${convErr.message}`);
      return false;
    }
    // rpc_convert_prospect already updated suggested_outreach.status to 'converted'.

    // Now log the call as a separate touchpoint, if a contact was created.
    const result = convData as { account_id?: string; contact_id?: string | null } | null;
    if (!result?.contact_id || !result?.account_id) {
      // No contact info on the prospect — conversion still succeeded, just no
      // touchpoint logged. Treat as a soft success so the session keeps moving.
      showToast(`${item.companyName} added; no contact to log against.`);
      return true;
    }
    const { error: tpErr } = await supabase.rpc("rpc_log_outreach_touchpoint", {
      p_contact_id: result.contact_id,
      p_account_id: result.account_id,
      p_touchpoint_type_id: callTypeId,
      p_property_id: null,
      p_outcome_id: outcome.id,
      p_notes: `Focus session · ${outcome.label}`,
      p_engagement_phase: "first_touch",
    });
    if (tpErr) {
      showToast(`Converted ${item.companyName}, but touchpoint failed: ${tpErr.message}`);
      // Conversion stuck — return true so the session advances and the rep can
      // log a touchpoint manually later if needed.
      return true;
    }
    return true;
  }

  async function handleOutcome(outcome: OutcomeButton) {
    if (!currentItem || busy) return;
    if (!callTypeId) {
      showToast("No 'call' touchpoint type configured for this org.");
      return;
    }
    setBusy(true);
    try {
      let ok = false;
      if (currentItem.kind === "follow_up") {
        ok = await logFollowUpOutcome(currentItem, outcome);
      } else {
        ok = await convertProspectAndLog(currentItem, outcome);
      }

      // Always advance the queue — failures show a toast and skip rather than block.
      const contactKey = currentItem.kind === "follow_up" ? currentItem.contactId : currentItem.prospectId;
      if (ok) {
        setCompleted((prev) => [
          ...prev,
          {
            contactKey,
            outcomeKey: outcome.key,
            points: outcome.points,
          },
        ]);
        if (outcome.key === "connected_conversation" || outcome.key === "inspection_scheduled") {
          showPulse();
        }
      }
      setQueue((prev) => prev.slice(1));
    } finally {
      setBusy(false);
    }
  }

  function handleSkip() {
    if (!currentItem || busy) return;
    setQueue((prev) => {
      if (prev.length <= 1) return prev;
      const [first, ...rest] = prev;
      return [...rest, first];
    });
  }

  function handleEndSession() {
    router.push("/app/today");
  }

  function handleStartAnother() {
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950 text-slate-100">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <button
          type="button"
          onClick={handleEndSession}
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          ✕ End Session
        </button>
        <div className="text-base font-mono tabular-nums text-slate-200">{fmtTimer(secondsElapsed)}</div>
        <div className="text-sm">
          🔥 <span className="font-semibold text-amber-300">{streakAtStart}</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 border-b border-slate-800 text-center">
        <div className="px-2 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Calls</div>
          <div className="text-lg font-semibold tabular-nums text-slate-100">{completed.length}</div>
        </div>
        <div className="px-2 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Connects</div>
          <div className="text-lg font-semibold tabular-nums text-emerald-300">{sessionConnects}</div>
        </div>
        <div className="px-2 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Inspections</div>
          <div className="text-lg font-semibold tabular-nums text-amber-300">{sessionInspections}</div>
        </div>
        <div className="px-2 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Points</div>
          <div className="text-lg font-semibold tabular-nums text-blue-300">{sessionPoints}</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="border-b border-slate-800 px-4 py-2">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>{callsToward} of {outreachTarget} daily calls</span>
          <span className="tabular-nums">{targetPct}%</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            className={[
              "h-2 rounded-full transition-all",
              targetMet
                ? "bg-emerald-500 animate-pulse"
                : targetPct >= 50
                  ? "bg-amber-400"
                  : "bg-slate-600",
              pulse ? "animate-pulse" : "",
            ].join(" ")}
            style={{ width: `${targetPct}%` }}
          />
        </div>
      </div>

      {/* Body */}
      {isComplete ? (
        <CompleteScreen
          completed={completed}
          targetMet={targetMet}
          streakAtStart={streakAtStart}
          userId={userId}
          onBack={handleEndSession}
          onAnother={handleStartAnother}
        />
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Contact card */}
          <div className="px-5 pt-6 pb-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-slate-500">
                <span>{queue.length} left</span>
                {currentItem!.kind === "prospect" && (
                  <span className="rounded-full bg-blue-900/60 px-2 py-0.5 text-[10px] font-semibold text-blue-200">
                    NEW PROSPECT
                  </span>
                )}
              </div>
              <h1 className="mt-1 text-2xl font-bold leading-tight text-slate-100">
                {currentItem!.primaryName}
              </h1>
              <div className="mt-1 text-base text-slate-300">{currentItem!.contactDisplay}</div>
              {currentItem!.phone && (
                <a
                  href={`tel:${currentItem!.phone}`}
                  className="mt-3 block text-2xl font-semibold tabular-nums text-blue-300 hover:underline"
                >
                  {formatPhone(currentItem!.phone)}
                </a>
              )}
              {currentItem!.propertyDisplay && (
                <p className="mt-2 text-sm text-slate-500">{currentItem!.propertyDisplay}</p>
              )}

              {/* Context line */}
              <div className="mt-3 border-t border-slate-800 pt-3 text-sm">
                {currentItem!.lastOutcomeName && currentItem!.daysSinceLastOutreach !== null ? (
                  <div>
                    <span className={`font-medium ${daysAgoColor(currentItem!.daysSinceLastOutreach)}`}>
                      Last outreach: {daysAgoLabel(currentItem!.daysSinceLastOutreach)}
                    </span>
                    <span className="text-slate-400"> · {currentItem!.lastOutcomeName}</span>
                  </div>
                ) : (
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-300">
                    First touch
                  </span>
                )}
                {currentItem!.notes && (
                  <p className="mt-1 italic text-slate-400">{currentItem!.notes}</p>
                )}
              </div>
            </div>

            {toast && (
              <p className="mt-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                {toast}
              </p>
            )}
          </div>

          {/* Outcome buttons */}
          <div className="flex-1 space-y-2 overflow-y-auto px-5 pb-6">
            {outcomeButtons.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={busy}
                onClick={() => void handleOutcome(o)}
                className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-left text-base font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-50"
              >
                <span>
                  <span className="mr-2 text-xl">{o.emoji}</span>
                  {o.label}
                </span>
                <span className="text-xs font-medium text-slate-400">+{o.points}</span>
              </button>
            ))}
            <button
              type="button"
              disabled={busy || queue.length <= 1}
              onClick={handleSkip}
              className="flex w-full items-center justify-center rounded-xl border border-slate-800 px-4 py-3 text-sm font-medium text-slate-400 hover:bg-slate-900 disabled:opacity-30"
            >
              ⏭ Skip (move to end of queue)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CompleteScreen({
  completed,
  targetMet,
  streakAtStart,
  userId,
  onBack,
  onAnother,
}: {
  completed: LoggedOutcome[];
  targetMet: boolean;
  streakAtStart: number;
  userId: string;
  onBack: () => void;
  onAnother: () => void;
}) {
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const [rank, setRank] = useState<{ position: number; total: number } | null>(null);

  // Fetch today's leaderboard rank once when complete screen mounts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("score_events")
        .select("user_id,points")
        .gte("created_at", startOfToday.toISOString());
      if (cancelled || error) return;
      const sums = new Map<string, number>();
      for (const r of (data ?? []) as { user_id: string; points: number }[]) {
        sums.set(r.user_id, (sums.get(r.user_id) ?? 0) + r.points);
      }
      const sorted = Array.from(sums.entries()).sort((a, b) => b[1] - a[1]);
      const idx = sorted.findIndex(([uid]) => uid === userId);
      if (idx >= 0) {
        setRank({ position: idx + 1, total: sorted.length });
      } else if (sorted.length > 0) {
        // Rep has no points today but other reps do — they're tied for last
        setRank({ position: sorted.length + 1, total: sorted.length + 1 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, userId]);

  const total = completed.length;
  const connects = completed.filter((c) => c.outcomeKey === "connected_conversation").length;
  const voicemails = completed.filter((c) => c.outcomeKey === "no_answer_voicemail").length;
  const noAnswers = completed.filter((c) => c.outcomeKey === "no_answer_no_voicemail").length;
  const inspections = completed.filter((c) => c.outcomeKey === "inspection_scheduled").length;
  const points = completed.reduce((s, c) => s + c.points, 0);

  return (
    <div
      className={`flex flex-1 flex-col items-center justify-center px-6 py-8 text-center ${
        targetMet ? "bg-gradient-to-b from-emerald-900/30 to-slate-950 animate-pulse" : ""
      }`}
    >
      <div className="text-7xl">🎉</div>
      <div className="mt-3 text-6xl font-bold tabular-nums text-slate-100">{total}</div>
      <div className="mt-1 text-sm uppercase tracking-wide text-slate-400">calls this session</div>

      <div className="mt-6 grid w-full max-w-sm grid-cols-2 gap-3 text-left">
        <Stat label="Connected" value={connects} />
        <Stat label="Voicemails" value={voicemails} />
        <Stat label="No Answer" value={noAnswers} />
        <Stat label="Inspections" value={inspections} hot />
        <Stat label="Points Earned" value={points} fullWidth />
      </div>

      {targetMet && (
        <p className="mt-6 text-base font-semibold text-emerald-300">🎯 Daily target crushed!</p>
      )}

      <p className="mt-4 text-sm text-slate-400">
        🔥 Day {streakAtStart} streak — keep it going
      </p>

      {rank && (
        <p className="mt-2 text-sm text-slate-400">
          You&apos;re <span className="font-semibold text-slate-200">#{rank.position}</span> on the team today
          {rank.total > 1 && <span className="text-slate-500"> · of {rank.total}</span>}
        </p>
      )}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
        >
          Back to Today
        </button>
        <button
          type="button"
          onClick={onAnother}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Start Another Session
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hot,
  fullWidth,
}: {
  label: string;
  value: number;
  hot?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-xl border border-slate-800 bg-slate-900 px-3 py-2",
        fullWidth ? "col-span-2" : "",
      ].join(" ")}
    >
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${hot ? "text-amber-300" : "text-slate-100"}`}>
        {value}
        {hot && value > 0 ? " 🔥" : ""}
      </div>
    </div>
  );
}
