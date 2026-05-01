"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { formatPhone } from "@/lib/utils/format";
import type { FocusQueueItem } from "./page";

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
  contactId: string;
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
}: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabase(), []);

  const [queue, setQueue] = useState<FocusQueueItem[]>(initialQueue);
  const [completed, setCompleted] = useState<LoggedOutcome[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);

  // Timer
  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => {
      setSecondsElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const currentContact: FocusQueueItem | null = queue[0] ?? null;
  const isComplete = currentContact === null;

  // Session-derived stats
  const sessionConnects = completed.filter((c) => c.outcomeKey === "connected_conversation").length;
  const sessionInspections = completed.filter((c) => c.outcomeKey === "inspection_scheduled").length;
  const sessionPoints = completed.reduce((s, c) => s + c.points, 0);

  // Calls toward daily target = touchpoints logged today PLUS calls in this session
  const callsToward = outreachAtStart + completed.length;
  const targetPct = outreachTarget > 0 ? Math.min(100, Math.round((callsToward / outreachTarget) * 100)) : 0;
  const targetMet = callsToward >= outreachTarget && outreachTarget > 0;

  function showPulse() {
    setPulse(true);
    setTimeout(() => setPulse(false), 500);
  }

  async function handleOutcome(outcome: OutcomeButton) {
    if (!currentContact || busy) return;
    if (!callTypeId) {
      setError("No 'call' touchpoint type configured for this org.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc("rpc_log_outreach_touchpoint", {
        p_contact_id: currentContact.contactId,
        p_account_id: currentContact.accountId,
        p_touchpoint_type_id: callTypeId,
        p_property_id: currentContact.propertyId ?? null,
        p_outcome_id: outcome.id,
        p_notes: `Focus session · ${outcome.label}`,
        p_engagement_phase: "follow_up",
      });
      if (rpcErr) {
        setError(rpcErr.message);
        return;
      }

      // Mark next_action complete (best effort)
      const row = Array.isArray(data) ? data[0] : data;
      const tpId = (row as Record<string, unknown> | null)?.touchpoint_id as string | undefined;
      await supabase
        .from("next_actions")
        .update({
          status: "completed",
          ...(tpId ? { completed_by_touchpoint_id: tpId } : {}),
        })
        .eq("id", currentContact.nextActionId)
        .eq("status", "open");

      setCompleted((prev) => [
        ...prev,
        {
          contactId: currentContact.contactId,
          outcomeKey: outcome.key,
          points: outcome.points,
        },
      ]);
      setQueue((prev) => prev.slice(1));

      if (outcome.key === "connected_conversation" || outcome.key === "inspection_scheduled") {
        showPulse();
      }
    } finally {
      setBusy(false);
    }
  }

  function handleSkip() {
    if (!currentContact || busy) return;
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
          onBack={handleEndSession}
          onAnother={handleStartAnother}
        />
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Contact card */}
          <div className="px-5 pt-6 pb-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                {queue.length} left
              </div>
              <h1 className="mt-1 text-2xl font-bold leading-tight text-slate-100">
                {currentContact!.accountName}
              </h1>
              <div className="mt-1 text-base text-slate-300">
                {currentContact!.contactName}
                {currentContact!.contactTitle && (
                  <span className="text-slate-500"> · {currentContact!.contactTitle}</span>
                )}
              </div>
              {currentContact!.contactPhone && (
                <a
                  href={`tel:${currentContact!.contactPhone}`}
                  className="mt-3 block text-2xl font-semibold tabular-nums text-blue-300 hover:underline"
                >
                  {formatPhone(currentContact!.contactPhone)}
                </a>
              )}
              {(currentContact!.propertyName || currentContact!.propertyAddress) && (
                <p className="mt-2 text-sm text-slate-500">
                  {currentContact!.propertyName ?? currentContact!.propertyAddress}
                </p>
              )}

              {/* Context line */}
              <div className="mt-3 border-t border-slate-800 pt-3 text-sm">
                {currentContact!.lastOutcomeName && currentContact!.daysSinceLastOutreach !== null ? (
                  <div>
                    <span className={`font-medium ${daysAgoColor(currentContact!.daysSinceLastOutreach)}`}>
                      Last outreach: {daysAgoLabel(currentContact!.daysSinceLastOutreach)}
                    </span>
                    <span className="text-slate-400"> · {currentContact!.lastOutcomeName}</span>
                  </div>
                ) : (
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-300">
                    First touch
                  </span>
                )}
                {currentContact!.notes && (
                  <p className="mt-1 italic text-slate-400">{currentContact!.notes}</p>
                )}
              </div>
            </div>

            {error && (
              <p className="mt-2 text-xs text-red-400">{error}</p>
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
  onBack,
  onAnother,
}: {
  completed: LoggedOutcome[];
  targetMet: boolean;
  streakAtStart: number;
  onBack: () => void;
  onAnother: () => void;
}) {
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
