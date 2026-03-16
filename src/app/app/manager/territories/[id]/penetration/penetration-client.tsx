"use client";

import { useState } from "react";
import type { PenetrationData } from "./page";

type Props = { data: PenetrationData };

function rateColor(rate: number): string {
  if (rate >= 30) return "text-green-700";
  if (rate >= 10) return "text-amber-700";
  return "text-red-700";
}

function barColor(rate: number): string {
  if (rate >= 30) return "bg-green-500";
  if (rate >= 10) return "bg-amber-500";
  return "bg-red-500";
}

function barBg(rate: number): string {
  if (rate >= 30) return "bg-green-100";
  if (rate >= 10) return "bg-amber-100";
  return "bg-red-100";
}

export default function PenetrationClient({ data }: Props) {
  return (
    <div className="space-y-4">
      {/* ── Hero metric ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Penetration Rate
        </div>
        <div className={`mt-1 text-4xl font-bold tabular-nums ${rateColor(data.penetrationRate)}`}>
          {data.penetrationRate}%
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full" style={{ backgroundColor: barBg(data.penetrationRate).replace("bg-", "") }}>
          <div
            className={`h-3 rounded-full transition-all ${barColor(data.penetrationRate)}`}
            style={{ width: `${Math.min(100, data.penetrationRate)}%` }}
          />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-lg font-bold text-slate-900">{data.totalProspects}</div>
            <div className="text-xs text-slate-500">Total</div>
          </div>
          <div>
            <div className="text-lg font-bold text-green-700">{data.worked}</div>
            <div className="text-xs text-slate-500">Converted</div>
          </div>
          <div>
            <div className="text-lg font-bold text-slate-600">{data.unworked}</div>
            <div className="text-xs text-slate-500">Unworked</div>
          </div>
        </div>
      </div>

      {/* ── Secondary metrics ────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center">
          <div className="text-lg font-bold text-emerald-700">{data.queued}</div>
          <div className="text-xs text-slate-500">Queued</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center">
          <div className="text-lg font-bold text-slate-500">{data.dismissed}</div>
          <div className="text-xs text-slate-500">Dismissed</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center">
          <div className={`text-lg font-bold ${data.conversionRate >= 50 ? "text-green-700" : "text-amber-700"}`}>
            {data.conversionRate}%
          </div>
          <div className="text-xs text-slate-500">Conv. Rate</div>
        </div>
      </div>

      {/* ── Rep breakdown ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="text-sm font-semibold text-slate-900">By Rep</div>
        </div>
        {data.repBreakdowns.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">
            No outreach assignments yet.
          </p>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5 font-medium">Rep</th>
                    <th className="px-4 py-2.5 text-right font-medium">Assigned</th>
                    <th className="px-4 py-2.5 text-right font-medium">Accepted</th>
                    <th className="px-4 py-2.5 text-right font-medium">Converted</th>
                    <th className="px-4 py-2.5 text-right font-medium">Dismissed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.repBreakdowns.map((r) => (
                    <tr key={r.userId} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-slate-900">{r.name}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{r.assigned}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-blue-700">{r.accepted}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-green-700">{r.converted}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{r.dismissed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-slate-100">
              {data.repBreakdowns.map((r) => (
                <div key={r.userId} className="px-4 py-3">
                  <div className="text-sm font-medium text-slate-900">{r.name}</div>
                  <div className="mt-1 flex gap-3 text-xs">
                    <span className="text-slate-500">{r.assigned} assigned</span>
                    <span className="text-blue-600">{r.accepted} accepted</span>
                    <span className="text-green-600">{r.converted} converted</span>
                    <span className="text-slate-400">{r.dismissed} dismissed</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Account type breakdown ───────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="text-sm font-semibold text-slate-900">By Account Type</div>
          <div className="text-xs text-slate-500">Where the unworked opportunity is</div>
        </div>
        {data.typeBreakdowns.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">No prospect data.</p>
        ) : (
          <>
            <div className="hidden sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 text-right font-medium">Total</th>
                    <th className="px-4 py-2.5 text-right font-medium">Unworked</th>
                    <th className="px-4 py-2.5 text-right font-medium">Converted</th>
                  </tr>
                </thead>
                <tbody>
                  {data.typeBreakdowns.map((t) => (
                    <tr key={t.accountType} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-slate-900">{t.label}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{t.total}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <span className={t.unworked > 0 ? "font-medium text-amber-700" : "text-slate-400"}>
                          {t.unworked}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-green-700">{t.converted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="sm:hidden divide-y divide-slate-100">
              {data.typeBreakdowns.map((t) => (
                <div key={t.accountType} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-900">{t.label}</span>
                    <span className="text-sm tabular-nums text-slate-700">{t.total} total</span>
                  </div>
                  <div className="mt-1 flex gap-3 text-xs">
                    <span className={t.unworked > 0 ? "font-medium text-amber-600" : "text-slate-400"}>
                      {t.unworked} unworked
                    </span>
                    <span className="text-green-600">{t.converted} converted</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Source breakdown ──────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="text-sm font-semibold text-slate-900">By Source</div>
          <div className="text-xs text-slate-500">Which import sources produce conversions</div>
        </div>
        {data.sourceBreakdowns.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">No prospect data.</p>
        ) : (
          <>
            <div className="hidden sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5 font-medium">Source</th>
                    <th className="px-4 py-2.5 text-right font-medium">Total</th>
                    <th className="px-4 py-2.5 text-right font-medium">Converted</th>
                    <th className="px-4 py-2.5 text-right font-medium">Conv %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sourceBreakdowns.map((s, i) => {
                    const pct = s.total > 0 ? Math.round((s.converted / s.total) * 100) : 0;
                    return (
                      <tr key={i} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-2.5 font-medium text-slate-900">
                          {s.source === "csv_import" ? "CSV Import" : s.source}
                          {s.sourceDetail && (
                            <span className="ml-1.5 text-xs text-slate-400">{s.sourceDetail}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{s.total}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-green-700">{s.converted}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{pct}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="sm:hidden divide-y divide-slate-100">
              {data.sourceBreakdowns.map((s, i) => {
                const pct = s.total > 0 ? Math.round((s.converted / s.total) * 100) : 0;
                return (
                  <div key={i} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-900">
                        {s.source === "csv_import" ? "CSV Import" : s.source}
                        {s.sourceDetail && (
                          <span className="ml-1.5 text-xs text-slate-400">{s.sourceDetail}</span>
                        )}
                      </span>
                      <span className="text-sm tabular-nums text-slate-700">{s.total}</span>
                    </div>
                    <div className="mt-1 flex gap-3 text-xs">
                      <span className="text-green-600">{s.converted} converted</span>
                      <span className="text-slate-400">{pct}% rate</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
