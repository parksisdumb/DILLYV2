"use client";

import { useState } from "react";
import type { IntelData } from "./page";

const SOURCE_LABELS: Record<string, string> = {
  edgar_10k: "EDGAR 10-K",
  google_places: "Google Places",
  web_intelligence: "Web Intelligence",
};

export default function IntelClient({ data }: { data: IntelData }) {
  const [pulling, setPulling] = useState(false);
  const [pullResult, setPullResult] = useState<string | null>(null);

  async function handlePull() {
    setPulling(true);
    setPullResult(null);

    try {
      const res = await fetch("/api/intel/distribute", { method: "POST" });
      const json = await res.json();

      if (res.ok) {
        setPullResult(
          "Distribution started. Refresh in a moment to see results."
        );
      } else {
        setPullResult(json.error || "Failed to start distribution");
      }
    } catch {
      setPullResult("Network error");
    } finally {
      setPulling(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900">Intel Pipeline</h1>
        <p className="mt-1 text-sm text-slate-500">
          Global prospect pool populated by AI agents — pull matching records
          into your org
        </p>
      </div>

      {pullResult && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
          {pullResult}
        </div>
      )}

      {/* Key metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Total Intel Pool
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900">
            {data.totalPool.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Active records across all sources
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Matching Your Territory
          </div>
          <div className="mt-1 text-2xl font-bold text-blue-600">
            {data.matchingCount.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Score ≥ 40, not yet pulled
          </div>
          {data.matchingCount > 0 && (
            <button
              type="button"
              onClick={handlePull}
              disabled={pulling}
              className="mt-3 w-full rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {pulling
                ? "Pulling..."
                : `Pull ${data.matchingCount} Matching Prospects`}
            </button>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Already Pulled
          </div>
          <div className="mt-1 text-2xl font-bold text-green-600">
            {data.pushedCount.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Records distributed to your org
          </div>
        </div>
      </div>

      {/* Source breakdown */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Pool by Source
        </h2>
        {data.sourceBreakdown.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">
            No intel prospects yet. Run the prospecting agent to populate the
            pool.
          </p>
        ) : (
          <div className="space-y-2">
            {data.sourceBreakdown.map((s) => {
              const pct =
                data.totalPool > 0
                  ? (s.count / data.totalPool) * 100
                  : 0;
              return (
                <div key={s.source_detail} className="flex items-center gap-3">
                  <div className="w-32 shrink-0 text-right text-sm font-medium text-slate-700">
                    {SOURCE_LABELS[s.source_detail] ?? s.source_detail}
                  </div>
                  <div className="relative h-6 flex-1 rounded bg-slate-100">
                    {pct > 0 && (
                      <div
                        className="h-full rounded bg-blue-400"
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    )}
                  </div>
                  <div className="w-16 text-right text-sm font-semibold text-slate-600">
                    {s.count.toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Last distribution */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="text-xs font-medium text-slate-500">
          Last Distribution
        </div>
        <div className="mt-1 text-sm text-slate-700">
          {data.lastDistributionAt
            ? new Date(data.lastDistributionAt).toLocaleString()
            : "Never — click Pull to run your first distribution"}
        </div>
      </div>
    </div>
  );
}
