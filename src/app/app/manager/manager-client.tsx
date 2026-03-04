"use client";

import { useState } from "react";
import Link from "next/link";
import type { RepStat, StageSummary, TopAccount } from "@/app/app/manager/page";

type Props = {
  repStats: RepStat[];
  stageSummaries: StageSummary[];
  topAccounts: TopAccount[];
  generatedAt: string;
};

type Tab = "today" | "leaderboard" | "compliance" | "pipeline" | "accounts";

// ── Progress bar ────────────────────────────────────────────────────────────

function ProgressBar({
  value,
  target,
  colorClass,
}: {
  value: number;
  target: number;
  colorClass: string;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-2 rounded-full transition-all ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-12 text-right text-xs tabular-nums text-slate-600">
        {value}/{target}
      </span>
    </div>
  );
}

// ── Compliance rate badge ───────────────────────────────────────────────────

function ComplianceBadge({ rate }: { rate: number }) {
  const cls =
    rate >= 80
      ? "bg-green-100 text-green-800"
      : rate >= 60
        ? "bg-amber-100 text-amber-800"
        : "bg-red-100 text-red-700";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{rate}%</span>;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function ManagerClient({ repStats, stageSummaries, topAccounts, generatedAt }: Props) {
  const [tab, setTab] = useState<Tab>("today");

  const generatedDate = new Date(generatedAt);
  const generatedLabel = generatedDate.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const tabs: { key: Tab; label: string }[] = [
    { key: "today", label: "Team Today" },
    { key: "leaderboard", label: "Leaderboard" },
    { key: "compliance", label: "Compliance" },
    { key: "pipeline", label: "Pipeline" },
    { key: "accounts", label: "Accounts" },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Manager Dashboard</h1>
        <span className="text-xs text-slate-400">as of {generatedLabel}</span>
      </div>

      {/* Tab bar */}
      <div className="flex overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={[
              "shrink-0 px-4 py-2.5 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-slate-500 hover:text-slate-800",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Team Today ──────────────────────────────────────────────── */}
      {tab === "today" && (
        <>
          {repStats.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              No reps found.{" "}
              <Link href="/app/admin/team" className="text-blue-600 hover:underline">
                Invite reps from the Team page.
              </Link>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {repStats.map((rep) => (
                <div key={rep.userId} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900">{rep.name}</div>
                      {rep.email && <div className="text-xs text-slate-400">{rep.email}</div>}
                    </div>
                    <button
                      disabled
                      title="Coming in Phase 2"
                      className="shrink-0 cursor-not-allowed rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-400"
                    >
                      Assign Prospect
                    </button>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-slate-500">
                        <span>First Touch</span>
                        <span className="font-medium text-slate-700">{Math.round((rep.firstTouchToday / rep.targetFirstTouch) * 100)}%</span>
                      </div>
                      <ProgressBar value={rep.firstTouchToday} target={rep.targetFirstTouch} colorClass="bg-blue-600" />
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-slate-500">
                        <span>Follow-Up</span>
                        <span className="font-medium text-slate-700">{Math.round((rep.followUpToday / rep.targetFollowUp) * 100)}%</span>
                      </div>
                      <ProgressBar value={rep.followUpToday} target={rep.targetFollowUp} colorClass="bg-amber-500" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Tab: Leaderboard ──────────────────────────────────────────────── */}
      {tab === "leaderboard" && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {repStats.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No rep data yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Rep</th>
                  <th className="px-4 py-3 text-right font-medium">This Week</th>
                  <th className="px-4 py-3 text-right font-medium">This Month</th>
                </tr>
              </thead>
              <tbody>
                {repStats
                  .slice()
                  .sort((a, b) => b.pointsThisWeek - a.pointsThisWeek)
                  .map((rep, idx) => (
                    <tr
                      key={rep.userId}
                      className={[
                        "border-b border-slate-100 last:border-0",
                        idx === 0 ? "bg-yellow-50" : "",
                      ].join(" ")}
                    >
                      <td className="px-4 py-3 font-bold text-slate-400">
                        {idx === 0 ? (
                          <span className="font-bold text-yellow-600">#1</span>
                        ) : (
                          `#${idx + 1}`
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">{rep.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className={idx === 0 ? "font-bold text-yellow-700" : "text-slate-700"}>
                          {rep.pointsThisWeek.toLocaleString()} pts
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                        {rep.pointsThisMonth.toLocaleString()} pts
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Tab: Compliance ───────────────────────────────────────────────── */}
      {tab === "compliance" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Follow-up completion rate — next actions due in the last 30 days.
          </p>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {repStats.every((r) => r.nextActionsTotal30d === 0) ? (
              <p className="p-6 text-sm text-slate-500">No follow-up data in the last 30 days.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 font-medium">Rep</th>
                    <th className="px-4 py-3 text-right font-medium">Completed</th>
                    <th className="px-4 py-3 text-right font-medium">Total (30d)</th>
                    <th className="px-4 py-3 text-right font-medium">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {repStats
                    .slice()
                    .sort((a, b) => b.complianceRate - a.complianceRate)
                    .map((rep) => (
                      <tr key={rep.userId} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-3 font-medium text-slate-900">{rep.name}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                          {rep.nextActionsCompleted30d}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                          {rep.nextActionsTotal30d}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {rep.nextActionsTotal30d > 0 ? (
                            <ComplianceBadge rate={rep.complianceRate} />
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Pipeline ─────────────────────────────────────────────────── */}
      {tab === "pipeline" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">Open opportunities by stage — days since created.</p>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {stageSummaries.every((s) => s.count === 0) ? (
              <p className="p-6 text-sm text-slate-500">No open opportunities.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 font-medium">Stage</th>
                    <th className="px-4 py-3 text-right font-medium">Opps</th>
                    <th className="px-4 py-3 text-right font-medium">Avg Days</th>
                    <th className="px-4 py-3 text-right font-medium">Max Days</th>
                  </tr>
                </thead>
                <tbody>
                  {stageSummaries.map((s) => (
                    <tr
                      key={s.stageId}
                      className={[
                        "border-b border-slate-100 last:border-0",
                        s.avgDaysOpen > 30 && s.count > 0 ? "bg-amber-50" : "",
                      ].join(" ")}
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">{s.stageName}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {s.count > 0 ? s.count : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {s.count > 0 ? (
                          <span className={s.avgDaysOpen > 30 ? "font-medium text-amber-700" : ""}>
                            {s.avgDaysOpen}d
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                        {s.count > 0 ? `${s.maxDaysOpen}d` : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Accounts ─────────────────────────────────────────────────── */}
      {tab === "accounts" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">Top accounts by touchpoint activity — last 30 days.</p>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {topAccounts.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">No touchpoint activity in the last 30 days.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 font-medium">Account</th>
                    <th className="px-4 py-3 text-right font-medium">Touchpoints</th>
                  </tr>
                </thead>
                <tbody>
                  {topAccounts.map((a, idx) => (
                    <tr key={a.accountId} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3">
                        <Link
                          href={`/app/accounts/${a.accountId}`}
                          className="font-medium text-blue-600 hover:underline"
                        >
                          {a.accountName}
                        </Link>
                        {idx === 0 && (
                          <span className="ml-2 rounded-full bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                            Top
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">
                        {a.touchpointCount30d}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
