"use client";

import { useState } from "react";
import type { IntelProspectRow, TerritoryMatchInfo } from "./page";

const SOURCE_LABELS: Record<string, string> = {
  edgar_10k_address: "EDGAR 10-K",
  google_places: "Google Places",
  cms_healthcare: "CMS Healthcare",
  web_intelligence: "Web Intel",
};

export default function ProspectsClient({
  prospects,
  sources,
  states,
  territoryMatch,
  orgId,
}: {
  prospects: IntelProspectRow[];
  sources: string[];
  states: string[];
  territoryMatch: TerritoryMatchInfo;
  orgId: string;
}) {
  const [sourceFilter, setSourceFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [scoreMin, setScoreMin] = useState(0);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<string | null>(null);

  const filtered = prospects.filter((p) => {
    if (sourceFilter !== "all" && p.source_detail !== sourceFilter) return false;
    if (stateFilter !== "all" && p.state?.toUpperCase() !== stateFilter) return false;
    if (p.confidence_score < scoreMin) return false;
    return true;
  });

  async function handlePush() {
    setPushing(true);
    setPushResult(null);
    try {
      const resp = await fetch("/api/intel/distribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });
      if (resp.ok) {
        setPushResult("Distribution triggered. Matching prospects will appear in your Suggested Outreach queue.");
      } else {
        const text = await resp.text();
        setPushResult(`Error: ${text}`);
      }
    } catch (err) {
      setPushResult(`Error: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setPushing(false);
    }
  }

  function scoreBadge(score: number) {
    const color =
      score >= 60
        ? "bg-green-100 text-green-700"
        : score >= 40
          ? "bg-amber-100 text-amber-700"
          : "bg-slate-100 text-slate-500";
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
        {score}
      </span>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Prospect Pool</h1>
          <p className="text-sm text-slate-500">
            {prospects.length} active prospects —{" "}
            <span className="font-medium text-blue-600">
              {territoryMatch.totalMatching} matching your territory
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePush}
            disabled={pushing}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pushing ? "Pushing..." : "Push to My Territory"}
          </button>
        </div>
      </div>

      {pushResult && (
        <div className={`mb-4 rounded-xl border p-3 text-sm ${pushResult.startsWith("Error") ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"}`}>
          {pushResult}
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          <option value="all">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s] ?? s}
            </option>
          ))}
        </select>
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          <option value="all">All states</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={scoreMin}
          onChange={(e) => setScoreMin(Number(e.target.value))}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          <option value={0}>Score: Any</option>
          <option value={40}>Score: 40+</option>
          <option value={60}>Score: 60+</option>
          <option value={80}>Score: 80+</option>
        </select>
        <span className="self-center text-xs text-slate-400">
          Showing {filtered.length} of {prospects.length}
        </span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          No prospects found. Run the Prospect Discovery Agent to populate data.
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white sm:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs font-semibold uppercase text-slate-400">
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Address</th>
                  <th className="px-3 py-2">City</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2 text-center">Score</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map((p) => (
                  <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900">
                      {p.company_name}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {p.address_line1 || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {p.city || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {p.state || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        {SOURCE_LABELS[p.source_detail] ?? p.source_detail}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {scoreBadge(p.confidence_score)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 100 && (
              <div className="border-t border-slate-100 px-3 py-2 text-center text-xs text-slate-400">
                Showing first 100 of {filtered.length} results
              </div>
            )}
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 sm:hidden">
            {filtered.slice(0, 50).map((p) => (
              <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-900">{p.company_name}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {[p.address_line1, p.city, p.state].filter(Boolean).join(", ") || "No address"}
                    </div>
                  </div>
                  {scoreBadge(p.confidence_score)}
                </div>
                <div className="mt-1 flex gap-2 text-xs">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                    {SOURCE_LABELS[p.source_detail] ?? p.source_detail}
                  </span>
                  {p.building_type && (
                    <span className="text-slate-400">{p.building_type}</span>
                  )}
                </div>
              </div>
            ))}
            {filtered.length > 50 && (
              <p className="text-center text-xs text-slate-400">
                Showing first 50 of {filtered.length} results
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
