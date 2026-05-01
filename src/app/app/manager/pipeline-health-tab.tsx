"use client";

import Link from "next/link";
import type { PipelineHealth, PipelineRow, PipelineSummary } from "@/app/app/manager/page";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const HEALTH_BADGE: Record<PipelineHealth, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-green-100 text-green-800" },
  cooling: { label: "Cooling", cls: "bg-amber-100 text-amber-800" },
  stalled: { label: "Stalled", cls: "bg-red-100 text-red-700" },
  no_activity: { label: "No Activity", cls: "bg-slate-200 text-slate-700" },
};

function StatCard({
  label,
  value,
  hint,
  tone = "slate",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "slate" | "green" | "amber" | "red";
}) {
  const tones: Record<string, string> = {
    slate: "text-slate-900",
    green: "text-green-700",
    amber: "text-amber-700",
    red: "text-red-700",
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tones[tone]}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function formatLastActivity(iso: string | null, days: number | null): string {
  if (iso === null || days === null) return "Never";
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export default function PipelineHealthTab({
  rows,
  summary,
}: {
  rows: PipelineRow[];
  summary: PipelineSummary;
}) {
  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Pipeline" value={money.format(summary.totalValue)} />
        <StatCard
          label="Active Deals"
          value={String(summary.activeCount)}
          hint="touchpoint in last 7 days"
          tone="green"
        />
        <StatCard
          label="Cooling"
          value={String(summary.coolingCount)}
          hint="8–21 days no activity"
          tone="amber"
        />
        <StatCard
          label="Stalled"
          value={String(summary.stalledCount + summary.noActivityCount)}
          hint={
            summary.noActivityCount > 0
              ? `${summary.stalledCount} 22+ days · ${summary.noActivityCount} no activity ever`
              : "22+ days no activity"
          }
          tone="red"
        />
      </div>

      {/* Main table */}
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No open opportunities.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Account</th>
                  <th className="px-4 py-2.5">Property</th>
                  <th className="px-4 py-2.5">Stage</th>
                  <th className="px-4 py-2.5 text-right">Value</th>
                  <th className="px-4 py-2.5">Rep</th>
                  <th className="px-4 py-2.5 text-right">Days in Stage</th>
                  <th className="px-4 py-2.5">Last Activity</th>
                  <th className="px-4 py-2.5">Health</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const badge = HEALTH_BADGE[r.health];
                  const propertyLabel = r.propertyName || r.propertyAddress || "—";
                  const propertyClass = r.propertyName ? "text-slate-900" : "text-slate-500";
                  return (
                    <tr
                      key={r.oppId}
                      className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/app/opportunities/${r.oppId}`}
                          className="font-medium text-slate-900 hover:text-blue-600"
                        >
                          {r.accountName}
                        </Link>
                        {r.oppTitle && (
                          <div className="text-xs text-slate-500">{r.oppTitle}</div>
                        )}
                      </td>
                      <td className={`px-4 py-3 ${propertyClass}`}>
                        <Link href={`/app/opportunities/${r.oppId}`} className="block">
                          {propertyLabel}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <Link href={`/app/opportunities/${r.oppId}`} className="block">
                          {r.stageName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        <Link href={`/app/opportunities/${r.oppId}`} className="block">
                          {r.estimatedValue != null ? money.format(r.estimatedValue) : "—"}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <Link href={`/app/opportunities/${r.oppId}`} className="block">
                          {r.repName ?? <span className="text-slate-400">Unassigned</span>}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                        <Link href={`/app/opportunities/${r.oppId}`} className="block">
                          {r.daysInStage}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <Link href={`/app/opportunities/${r.oppId}`} className="block">
                          {formatLastActivity(r.lastActivityAt, r.daysSinceActivity)}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="divide-y divide-slate-100 md:hidden">
            {rows.map((r) => {
              const badge = HEALTH_BADGE[r.health];
              const propertyLabel = r.propertyName || r.propertyAddress || "—";
              return (
                <Link
                  key={r.oppId}
                  href={`/app/opportunities/${r.oppId}`}
                  className="block p-4 hover:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-900">{r.accountName}</div>
                      <div className={`text-sm ${r.propertyName ? "text-slate-700" : "text-slate-500"}`}>
                        {propertyLabel}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>{r.stageName}</span>
                    <span className="tabular-nums">{r.estimatedValue != null ? money.format(r.estimatedValue) : "—"}</span>
                    <span>{r.repName ?? "Unassigned"}</span>
                    <span className="tabular-nums">{r.daysInStage}d in stage</span>
                    <span>· {formatLastActivity(r.lastActivityAt, r.daysSinceActivity)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
