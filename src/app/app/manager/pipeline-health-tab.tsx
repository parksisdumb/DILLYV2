"use client";

import { useState } from "react";
import Link from "next/link";
import { createBrowserSupabase } from "@/lib/supabase/browser";
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

function coverageColor(ratio: number): string {
  if (ratio >= 3) return "text-green-700";
  if (ratio >= 2) return "text-amber-700";
  return "text-red-700";
}

function MonthlyTargetSection({
  totalValue,
  orgId,
  monthlyRevenueDefId,
  initialTarget,
  initialTargetId,
}: {
  totalValue: number;
  orgId: string;
  monthlyRevenueDefId: string | null;
  initialTarget: number | null;
  initialTargetId: string | null;
}) {
  const supabase = createBrowserSupabase();
  const [target, setTarget] = useState<number | null>(initialTarget);
  const [targetId, setTargetId] = useState<string | null>(initialTargetId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(initialTarget != null ? String(initialTarget) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Definition row missing (migration not applied) — render a noisy hint so the
  // manager understands why they can't set a target. Should not happen in prod.
  if (!monthlyRevenueDefId) {
    return (
      <p className="text-xs text-amber-700">
        Monthly revenue target definition is missing. Run the latest migration to enable this.
      </p>
    );
  }

  async function handleSave() {
    const parsed = Number(draft.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("Enter a positive dollar amount.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (targetId) {
        const { error: updErr } = await supabase
          .from("kpi_targets")
          .update({ target_value: parsed })
          .eq("id", targetId);
        if (updErr) { setError(updErr.message); return; }
      } else {
        const { data: inserted, error: insErr } = await supabase
          .from("kpi_targets")
          .insert({
            org_id: orgId,
            user_id: null,
            kpi_definition_id: monthlyRevenueDefId,
            period: "monthly",
            target_value: parsed,
          })
          .select("id")
          .single();
        if (insErr) { setError(insErr.message); return; }
        setTargetId(inserted.id as string);
      }
      setTarget(parsed);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3">
        <label className="block text-xs font-medium text-slate-600">Monthly Revenue Target</label>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-700">$</span>
          <input
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setError(null); }}
            placeholder="500000"
            className="w-40 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
            autoFocus
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSave()}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => { setEditing(false); setError(null); setDraft(target != null ? String(target) : ""); }}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Cancel
          </button>
        </div>
        {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  if (target == null || target <= 0) {
    return (
      <p className="text-sm text-slate-500">
        Set a monthly target to see pipeline coverage{" "}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="font-medium text-blue-600 hover:underline"
        >
          → Set Target
        </button>
      </p>
    );
  }

  const ratio = totalValue / target;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-slate-600">Pipeline coverage:</span>
      <span className={`font-semibold ${coverageColor(ratio)}`}>
        {ratio.toFixed(1)}x
      </span>
      <span className="text-xs text-slate-400">
        ({money.format(totalValue)} / {money.format(target)} monthly target)
      </span>
      <button
        type="button"
        aria-label="Edit monthly target"
        onClick={() => { setDraft(String(target)); setEditing(true); }}
        className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L4 13.172V16h2.828l7.379-7.379-2.828-2.828z" />
        </svg>
      </button>
    </div>
  );
}

export default function PipelineHealthTab({
  rows,
  summary,
  orgId,
  monthlyRevenueDefId,
  initialMonthlyTarget,
  initialMonthlyTargetId,
}: {
  rows: PipelineRow[];
  summary: PipelineSummary;
  orgId: string;
  monthlyRevenueDefId: string | null;
  initialMonthlyTarget: number | null;
  initialMonthlyTargetId: string | null;
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

      {/* Coverage line + set/edit target */}
      <MonthlyTargetSection
        totalValue={summary.totalValue}
        orgId={orgId}
        monthlyRevenueDefId={monthlyRevenueDefId}
        initialTarget={initialMonthlyTarget}
        initialTargetId={initialMonthlyTargetId}
      />

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
