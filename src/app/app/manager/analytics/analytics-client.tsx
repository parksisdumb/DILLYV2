"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  AnalyticsData,
  AnalyticsTouchpoint,
  AnalyticsOpportunity,
  AnalyticsNextAction,
} from "./page";

// ── Types ────────────────────────────────────────────────────────────────────

type DateRange = "30d" | "90d" | "12m" | "all";
type SortKey =
  | "name"
  | "first_touches"
  | "compliance"
  | "opps_created"
  | "deals_won"
  | "avg_days";
type SortDir = "asc" | "desc";

type RepRow = {
  id: string;
  name: string;
  first_touches: number;
  compliance: number;
  opps_created: number;
  deals_won: number;
  avg_days: number | null;
};

type FunnelStage = {
  label: string;
  count: number;
  dropoff: number | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "12m", label: "Last 12 months" },
  { value: "all", label: "All time" },
];

function rangeStart(range: DateRange): Date {
  const now = new Date();
  switch (range) {
    case "30d":
      return new Date(now.getTime() - 30 * 86400000);
    case "90d":
      return new Date(now.getTime() - 90 * 86400000);
    case "12m":
      return new Date(now.getTime() - 365 * 86400000);
    case "all":
      return new Date(0);
  }
}

function filterByDate<T extends { happened_at?: string; opened_at?: string; due_at?: string }>(
  items: T[],
  range: DateRange,
  dateField: "happened_at" | "opened_at" | "due_at"
): T[] {
  const start = rangeStart(range).toISOString();
  return items.filter((item) => {
    const val = item[dateField as keyof T] as string | undefined;
    return val && val >= start;
  });
}

function pct(num: number, den: number): number {
  return den > 0 ? Math.round((num / den) * 100) : 0;
}

function compareColor(orgVal: number, platformVal: number, higherIsBetter: boolean): string {
  if (platformVal === 0) return "text-slate-900";
  if (higherIsBetter) {
    return orgVal >= platformVal ? "text-green-600" : "text-red-600";
  }
  return orgVal <= platformVal ? "text-green-600" : "text-red-600";
}

function formatDays(d: number | null): string {
  if (d === null || d === 0) return "—";
  return `${d.toFixed(1)}d`;
}

// ── CSV Export ───────────────────────────────────────────────────────────────

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AnalyticsClient({ data }: { data: AnalyticsData }) {
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [repFilter, setRepFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("first_touches");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // ── Filtered data ──────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let tp = filterByDate(data.touchpoints, dateRange, "happened_at");
    let opps = filterByDate(data.opportunities, dateRange, "opened_at");
    let na = filterByDate(data.nextActions, dateRange, "due_at");

    if (repFilter !== "all") {
      tp = tp.filter((t) => t.rep_user_id === repFilter);
      opps = opps.filter((o) => o.created_by === repFilter);
      na = na.filter((n) => n.assigned_user_id === repFilter);
    }

    return { touchpoints: tp, opportunities: opps, nextActions: na };
  }, [data, dateRange, repFilter]);

  // ── Benchmark comparison ───────────────────────────────────────────────

  const benchmarks = useMemo(() => {
    const { touchpoints: tp, opportunities: opps, nextActions: na } = filtered;

    // Org: avg touches to first meeting (live computed)
    const contactFirstMeeting = new Map<string, string>();
    for (const t of tp) {
      if (
        (t.type_key === "meeting" || t.type_key === "inspection") &&
        t.contact_id &&
        !contactFirstMeeting.has(t.contact_id)
      ) {
        contactFirstMeeting.set(t.contact_id, t.happened_at);
      }
    }
    let totalTouches = 0;
    let meetingContacts = 0;
    for (const [contactId, meetingAt] of contactFirstMeeting) {
      const outreachBefore = tp.filter(
        (t) =>
          t.is_outreach &&
          t.contact_id === contactId &&
          t.happened_at <= meetingAt
      ).length;
      totalTouches += outreachBefore;
      meetingContacts++;
    }
    const orgAvgTouches =
      meetingContacts > 0
        ? Math.round((totalTouches / meetingContacts) * 10) / 10
        : 0;

    // Org: pipeline velocity
    const wonOpps = opps.filter(
      (o) => o.status === "won" && o.closed_at
    );
    const orgVelocity =
      wonOpps.length > 0
        ? Math.round(
            (wonOpps.reduce((sum, o) => {
              const days =
                (new Date(o.closed_at!).getTime() -
                  new Date(o.opened_at).getTime()) /
                86400000;
              return sum + days;
            }, 0) /
              wonOpps.length) *
              10
          ) / 10
        : null;

    // Org: follow-up compliance
    const completedOnTime = na.filter(
      (n) =>
        n.status === "completed" &&
        new Date(n.updated_at) <= new Date(new Date(n.due_at).getTime() + 86400000)
    ).length;
    const totalActions = na.filter(
      (n) => n.status === "completed" || n.status === "open"
    ).length;
    const orgCompliance = pct(completedOnTime, totalActions);

    // Org: top channel
    const channelWins = new Map<string, number>();
    for (const t of tp) {
      if (t.is_outreach && t.outcome_key === "connected_conversation") {
        channelWins.set(
          t.type_key,
          (channelWins.get(t.type_key) ?? 0) + 1
        );
      }
    }
    let topChannel = "—";
    let topChannelCount = 0;
    for (const [ch, count] of channelWins) {
      if (count > topChannelCount) {
        topChannel = ch;
        topChannelCount = count;
      }
    }

    // Platform benchmarks from snapshots
    const platTouches = (
      data.platformBenchmarks.avg_touches_to_first_meeting?.metric_value as {
        value?: number;
      }
    )?.value ?? null;
    const platVelocity = (
      data.platformBenchmarks.pipeline_velocity?.metric_value as {
        avg_days?: number;
      }
    )?.avg_days ?? null;
    const platCompliance = (
      data.platformBenchmarks.follow_up_compliance_rate?.metric_value as {
        rate?: number;
      }
    )?.rate ?? null;

    return {
      orgAvgTouches,
      platAvgTouches: platTouches,
      orgVelocity,
      platVelocity: platVelocity,
      orgCompliance,
      platCompliance: platCompliance,
      topChannel: CHANNEL_LABELS[topChannel] ?? topChannel,
      topChannelCount,
    };
  }, [filtered, data.platformBenchmarks]);

  // ── Funnel ─────────────────────────────────────────────────────────────

  const funnel = useMemo((): FunnelStage[] => {
    const { touchpoints: tp, opportunities: opps } = filtered;

    const prospects = data.prospectCounts.total;
    const firstTouch = new Set(
      tp
        .filter((t) => t.is_outreach && t.engagement_phase === "first_touch" && t.contact_id)
        .map((t) => t.contact_id)
    ).size;
    const followUp = new Set(
      tp
        .filter((t) => t.is_outreach && t.engagement_phase === "follow_up" && t.contact_id)
        .map((t) => t.contact_id)
    ).size;
    const inspScheduled = tp.filter(
      (t) => t.outcome_key === "inspection_scheduled"
    ).length;
    const bidSubmitted = tp.filter(
      (t) => t.outcome_key === "bid_submitted"
    ).length;
    const won = opps.filter((o) => o.status === "won").length;

    const stages = [
      { label: "Prospects", count: prospects },
      { label: "First Touch", count: firstTouch },
      { label: "Follow-Up", count: followUp },
      { label: "Inspection Scheduled", count: inspScheduled },
      { label: "Bid Submitted", count: bidSubmitted },
      { label: "Won", count: won },
    ];

    return stages.map((s, i) => ({
      ...s,
      dropoff:
        i === 0 || stages[i - 1].count === 0
          ? null
          : Math.round(
              ((stages[i - 1].count - s.count) / stages[i - 1].count) * 100
            ),
    }));
  }, [filtered, data.prospectCounts]);

  // ── Rep performance ────────────────────────────────────────────────────

  const repRows = useMemo((): RepRow[] => {
    const { touchpoints: tp, opportunities: opps, nextActions: na } = filtered;

    const rows: RepRow[] = data.reps.map((rep) => {
      const repTp = tp.filter((t) => t.rep_user_id === rep.id);
      const repOpps = opps.filter((o) => o.created_by === rep.id);
      const repNa = na.filter((n) => n.assigned_user_id === rep.id);

      const first_touches = repTp.filter(
        (t) => t.is_outreach && t.engagement_phase === "first_touch"
      ).length;

      const totalNa = repNa.filter(
        (n) => n.status === "completed" || n.status === "open"
      ).length;
      const onTimeNa = repNa.filter(
        (n) =>
          n.status === "completed" &&
          new Date(n.updated_at) <= new Date(new Date(n.due_at).getTime() + 86400000)
      ).length;
      const compliance = pct(onTimeNa, totalNa);

      const opps_created = repOpps.length;
      const wonOpps = repOpps.filter(
        (o) => o.status === "won" && o.closed_at
      );
      const deals_won = wonOpps.length;

      const avg_days =
        wonOpps.length > 0
          ? Math.round(
              (wonOpps.reduce(
                (s, o) =>
                  s +
                  (new Date(o.closed_at!).getTime() -
                    new Date(o.opened_at).getTime()) /
                    86400000,
                0
              ) /
                wonOpps.length) *
                10
            ) / 10
          : null;

      return { id: rep.id, name: rep.name, first_touches, compliance, opps_created, deals_won, avg_days };
    });

    // Filter out reps with zero activity
    const active = rows.filter(
      (r) =>
        r.first_touches > 0 ||
        r.opps_created > 0 ||
        r.deals_won > 0
    );

    active.sort((a, b) => {
      const aVal = a[sortKey] ?? 0;
      const bVal = b[sortKey] ?? 0;
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return sortDir === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });

    return active;
  }, [filtered, data.reps, sortKey, sortDir]);

  // ── Pipeline velocity + deals at risk ──────────────────────────────────

  const pipeline = useMemo(() => {
    const { opportunities: opps } = filtered;
    const openOpps = opps.filter((o) => o.status === "open");

    // Weekly opp creation (last 12 weeks)
    const weeklyCreation: { week: string; count: number }[] = [];
    const now = new Date();
    for (let w = 11; w >= 0; w--) {
      const weekStart = new Date(now.getTime() - (w + 1) * 7 * 86400000);
      const weekEnd = new Date(now.getTime() - w * 7 * 86400000);
      const label = `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;
      const count = opps.filter((o) => {
        const d = new Date(o.opened_at);
        return d >= weekStart && d < weekEnd;
      }).length;
      weeklyCreation.push({ week: label, count });
    }

    // Deals at risk: open opps with no touchpoint in 14+ days
    const fourteenDaysAgo = new Date(
      now.getTime() - 14 * 86400000
    ).toISOString();
    const atRisk = openOpps.filter(
      (o) => !o.last_touchpoint_at || o.last_touchpoint_at < fourteenDaysAgo
    );

    return { weeklyCreation, atRisk, openCount: openOpps.length };
  }, [filtered]);

  // ── Sort handler ───────────────────────────────────────────────────────

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  // ── Export ─────────────────────────────────────────────────────────────

  function handleExport() {
    const headers = [
      "Rep",
      "First Touches",
      "Follow-Up Compliance %",
      "Opps Created",
      "Deals Won",
      "Avg Days to Close",
    ];
    const rows = repRows.map((r) => [
      r.name,
      String(r.first_touches),
      String(r.compliance),
      String(r.opps_created),
      String(r.deals_won),
      r.avg_days !== null ? String(r.avg_days) : "",
    ]);
    const rangeName = DATE_RANGES.find((d) => d.value === dateRange)?.label ?? dateRange;
    downloadCsv(
      `analytics_${rangeName.replace(/\s+/g, "_").toLowerCase()}.csv`,
      headers,
      rows
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const maxFunnel = funnel.length > 0 ? Math.max(...funnel.map((f) => f.count), 1) : 1;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      {/* Header + filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold text-slate-900">Analytics</h1>
        <div className="flex flex-wrap gap-2">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as DateRange)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
          >
            {DATE_RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <select
            value={repFilter}
            onChange={(e) => setRepFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
          >
            <option value="all">All reps</option>
            {data.reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleExport}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* ── Section 1: Org vs Platform Benchmark ─────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Your Organization vs Platform
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <BenchmarkCard
            label="Avg Touches to Meeting"
            orgValue={benchmarks.orgAvgTouches}
            platformValue={benchmarks.platAvgTouches}
            format={(v) => String(v)}
            higherIsBetter={false}
          />
          <BenchmarkCard
            label="Pipeline Velocity"
            orgValue={benchmarks.orgVelocity}
            platformValue={benchmarks.platVelocity}
            format={(v) => (v !== null ? `${v}d` : "—")}
            higherIsBetter={false}
          />
          <BenchmarkCard
            label="Follow-Up Compliance"
            orgValue={benchmarks.orgCompliance}
            platformValue={benchmarks.platCompliance}
            format={(v) => (v !== null ? `${v}%` : "—")}
            higherIsBetter={true}
          />
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <div className="text-xs font-medium text-slate-500">
              Top Channel
            </div>
            <div className="mt-1 text-lg font-bold text-slate-900">
              {benchmarks.topChannel}
            </div>
            <div className="text-xs text-slate-400">
              {benchmarks.topChannelCount} connections
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 2: Touchpoint-to-Close Funnel ────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Touchpoint-to-Close Funnel
        </h2>
        <div className="space-y-2">
          {funnel.map((stage) => (
            <div key={stage.label} className="flex items-center gap-3">
              <div className="w-36 shrink-0 text-right text-sm font-medium text-slate-700 sm:w-44">
                {stage.label}
              </div>
              <div className="relative flex-1">
                <div
                  className="h-8 rounded-lg bg-blue-500 transition-all"
                  style={{
                    width: `${Math.max((stage.count / maxFunnel) * 100, 2)}%`,
                  }}
                />
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-bold text-white">
                  {stage.count.toLocaleString()}
                </span>
              </div>
              <div className="w-14 shrink-0 text-right text-xs text-slate-400">
                {stage.dropoff !== null ? `${stage.dropoff}% drop` : ""}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Section 3: Rep Performance ────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Rep Performance
        </h2>

        {repRows.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">
            No rep activity in this period.
          </p>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs font-semibold uppercase text-slate-400">
                    {(
                      [
                        ["name", "Rep"],
                        ["first_touches", "First Touches"],
                        ["compliance", "Follow-Up %"],
                        ["opps_created", "Opps Created"],
                        ["deals_won", "Won"],
                        ["avg_days", "Avg Days"],
                      ] as [SortKey, string][]
                    ).map(([key, label]) => (
                      <th
                        key={key}
                        className="cursor-pointer whitespace-nowrap px-3 py-2 hover:text-slate-600"
                        onClick={() => handleSort(key)}
                      >
                        {label}
                        {sortIndicator(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {repRows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-slate-50 hover:bg-slate-50"
                    >
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {r.name}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {r.first_touches}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            r.compliance >= 80
                              ? "text-green-600"
                              : r.compliance >= 50
                                ? "text-amber-600"
                                : "text-red-600"
                          }
                        >
                          {r.compliance}%
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {r.opps_created}
                      </td>
                      <td className="px-3 py-2 font-semibold text-green-600">
                        {r.deals_won}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {formatDays(r.avg_days)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="space-y-3 sm:hidden">
              {repRows.map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl border border-slate-100 bg-slate-50 p-3"
                >
                  <div className="font-semibold text-slate-900">{r.name}</div>
                  <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                    <span>First Touches: {r.first_touches}</span>
                    <span>
                      Compliance:{" "}
                      <span
                        className={
                          r.compliance >= 80
                            ? "text-green-600"
                            : r.compliance >= 50
                              ? "text-amber-600"
                              : "text-red-600"
                        }
                      >
                        {r.compliance}%
                      </span>
                    </span>
                    <span>Opps: {r.opps_created}</span>
                    <span>Won: {r.deals_won}</span>
                    <span>Avg Close: {formatDays(r.avg_days)}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Section 4: Pipeline Velocity ──────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Pipeline Velocity
        </h2>

        {/* Weekly chart (simple bar representation) */}
        <div className="mb-6">
          <div className="mb-2 text-xs font-medium text-slate-500">
            Opportunities Created per Week
          </div>
          <div className="flex items-end gap-1">
            {pipeline.weeklyCreation.map((w) => {
              const maxWeek = Math.max(
                ...pipeline.weeklyCreation.map((x) => x.count),
                1
              );
              return (
                <div
                  key={w.week}
                  className="flex flex-1 flex-col items-center"
                >
                  <div className="mb-1 text-[10px] font-medium text-slate-500">
                    {w.count > 0 ? w.count : ""}
                  </div>
                  <div
                    className="w-full rounded-t bg-blue-400"
                    style={{
                      height: `${Math.max((w.count / maxWeek) * 80, 2)}px`,
                    }}
                  />
                  <div className="mt-1 text-[9px] text-slate-400">
                    {w.week}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Deals at risk */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500">
              Deals at Risk
            </span>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
              {pipeline.atRisk.length}
            </span>
            <span className="text-[10px] text-slate-400">
              No touchpoint in 14+ days
            </span>
          </div>

          {pipeline.atRisk.length === 0 ? (
            <p className="py-2 text-sm text-slate-400">
              No at-risk deals. All open opportunities have recent activity.
            </p>
          ) : (
            <div className="space-y-2">
              {pipeline.atRisk.slice(0, 10).map((o) => (
                <Link
                  key={o.id}
                  href={`/app/opportunities/${o.id}`}
                  className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-3 hover:bg-amber-100"
                >
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      {o.title || o.account_name || "Untitled Opportunity"}
                    </div>
                    <div className="text-xs text-slate-500">
                      Last touch:{" "}
                      {o.last_touchpoint_at
                        ? `${Math.round((Date.now() - new Date(o.last_touchpoint_at).getTime()) / 86400000)}d ago`
                        : "Never"}
                    </div>
                  </div>
                  {o.estimated_value && (
                    <div className="text-sm font-semibold text-slate-700">
                      ${Number(o.estimated_value).toLocaleString()}
                    </div>
                  )}
                </Link>
              ))}
              {pipeline.atRisk.length > 10 && (
                <p className="text-xs text-slate-400">
                  + {pipeline.atRisk.length - 10} more
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function BenchmarkCard({
  label,
  orgValue,
  platformValue,
  format,
  higherIsBetter,
}: {
  label: string;
  orgValue: number | null;
  platformValue: number | null;
  format: (v: number | null) => string;
  higherIsBetter: boolean;
}) {
  const orgDisplay = format(orgValue);
  const platDisplay = platformValue !== null ? format(platformValue) : "—";
  const colorClass =
    orgValue !== null && platformValue !== null
      ? compareColor(orgValue, platformValue, higherIsBetter)
      : "text-slate-900";

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-bold ${colorClass}`}>
        {orgDisplay}
      </div>
      <div className="text-xs text-slate-400">
        Platform avg: {platDisplay}
      </div>
    </div>
  );
}

// ── Channel labels ───────────────────────────────────────────────────────────

const CHANNEL_LABELS: Record<string, string> = {
  call: "Phone Call",
  email: "Email",
  text: "Text",
  door_knock: "Door Knock",
  site_visit: "Site Visit",
  inspection: "Inspection",
  bid_sent: "Bid Sent",
  meeting: "Meeting",
};
