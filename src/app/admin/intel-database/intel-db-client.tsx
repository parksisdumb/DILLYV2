"use client";

import { useState } from "react";
import type {
  DbHealth,
  SourceBreakdown,
  StateBreakdown,
  WeeklyGrowth,
  AgentRunRow,
} from "./page";

// ── Health stat card ─────────────────────────────────────────────────────────

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-0.5 text-lg font-bold text-white">{typeof value === "number" ? value.toLocaleString() : value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function IntelDbClient({
  health,
  sourceBreakdown,
  stateBreakdown,
  weeklyGrowth,
  agentRuns,
}: {
  health: DbHealth;
  sourceBreakdown: SourceBreakdown[];
  stateBreakdown: StateBreakdown[];
  weeklyGrowth: WeeklyGrowth[];
  agentRuns: AgentRunRow[];
}) {
  const [search, setSearch] = useState("");
  const [triggerBusy, setTriggerBusy] = useState<string | null>(null);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);

  async function triggerAgent(eventName: string) {
    setTriggerBusy(eventName);
    setTriggerResult(null);
    try {
      const resp = await fetch("/api/intel/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: eventName }),
      });
      if (resp.ok) {
        setTriggerResult(`Triggered ${eventName}`);
      } else {
        setTriggerResult(`Error: ${resp.status}`);
      }
    } catch {
      setTriggerResult("Network error");
    } finally {
      setTriggerBusy(null);
      setTimeout(() => setTriggerResult(null), 3000);
    }
  }

  const maxWeekly = Math.max(...weeklyGrowth.map((w) => w.prospects + w.properties), 1);

  const statusColors: Record<string, string> = {
    completed: "bg-green-500/20 text-green-400",
    running: "bg-blue-500/20 text-blue-400",
    failed: "bg-red-500/20 text-red-400",
  };

  return (
    <div className="space-y-6">
      {/* Toast */}
      {triggerResult && (
        <div className="fixed right-4 top-4 z-50 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
          {triggerResult}
        </div>
      )}

      {/* ── Section 1: Database Health ────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Properties" value={health.totalProperties} />
        <Stat label="Prospects" value={health.totalProspects} />
        <Stat label="Entities" value={health.totalEntities} />
        <Stat label="With Address" value={health.withAddress} sub={`${health.pctAddress}%`} />
        <Stat label="With Phone" value={health.withPhone} sub={`${health.pctPhone}%`} />
        <Stat label="With Email" value={health.withEmail} sub={`${health.pctEmail}%`} />
        <Stat label="With Owner" value={health.withOwner} sub={`${health.pctOwner}%`} />
      </div>

      {/* ── Section 2: Breakdowns ─────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* By source */}
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">By Source</h2>
          <div className="space-y-1.5">
            {sourceBreakdown.map((s) => (
              <div key={s.source} className="flex items-center gap-2">
                <div className="w-36 truncate text-xs text-slate-400">{s.source}</div>
                <div className="flex-1">
                  <div
                    className="h-4 rounded bg-blue-500/30"
                    style={{ width: `${Math.max((s.count / (health.totalProspects || 1)) * 100, 2)}%` }}
                  />
                </div>
                <div className="w-16 text-right text-xs text-slate-300">
                  {s.count} <span className="text-slate-500">({s.pct}%)</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* By state */}
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">By State (Top 15)</h2>
          <div className="space-y-1.5">
            {stateBreakdown.map((s) => (
              <div key={s.state} className="flex items-center gap-2">
                <div className="w-10 text-xs font-medium text-slate-400">{s.state}</div>
                <div className="flex-1">
                  <div
                    className="h-4 rounded bg-green-500/30"
                    style={{ width: `${Math.max((s.count / (stateBreakdown[0]?.count || 1)) * 100, 2)}%` }}
                  />
                </div>
                <div className="w-12 text-right text-xs text-slate-300">{s.count}</div>
              </div>
            ))}
            {stateBreakdown.length === 0 && (
              <p className="text-xs text-slate-500">No state data yet</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Section 3: Weekly Growth ──────────────────────────────────── */}
      <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Records Added Per Week</h2>
        <div className="flex items-end gap-1" style={{ height: 100 }}>
          {weeklyGrowth.map((w) => {
            const total = w.properties + w.prospects;
            return (
              <div key={w.week} className="flex flex-1 flex-col items-center">
                {total > 0 && (
                  <div className="mb-1 text-[9px] text-slate-400">{total}</div>
                )}
                <div className="flex w-full flex-col gap-0.5">
                  <div
                    className="w-full rounded-t bg-blue-400/60"
                    style={{ height: `${Math.max((w.prospects / maxWeekly) * 60, 1)}px` }}
                  />
                  <div
                    className="w-full rounded-b bg-green-400/60"
                    style={{ height: `${Math.max((w.properties / maxWeekly) * 60, 1)}px` }}
                  />
                </div>
                <div className="mt-1 text-[8px] text-slate-500">{w.week}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex gap-4 text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded bg-blue-400/60" /> Prospects
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded bg-green-400/60" /> Properties
          </span>
        </div>
      </div>

      {/* ── Section 4: Search ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Data Quality Search</h2>
        <p className="mb-2 text-xs text-slate-500">
          Search intel_prospects by company name, city, or state. Use the Supabase Studio SQL Editor for advanced queries.
        </p>
        <input
          type="text"
          placeholder="Search company name, city, or state..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
        />
        {search.length >= 2 && (
          <p className="mt-2 text-xs text-slate-500">
            For search results, use Supabase Studio → SQL Editor:
            <code className="ml-1 rounded bg-slate-900 px-1 py-0.5 text-[10px] text-slate-400">
              SELECT * FROM intel_prospects WHERE company_name ILIKE &apos;%{search}%&apos; OR city ILIKE &apos;%{search}%&apos; LIMIT 20;
            </code>
          </p>
        )}
      </div>

      {/* ── Section 5: Agent Runs ─────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-300">Agent Runs (Last 20)</h2>
          <div className="flex gap-2">
            {[
              { label: "EDGAR", event: "app/edgar-intelligence.run" },
              { label: "Discovery", event: "app/prospect-discovery.run" },
              { label: "Enrichment", event: "app/enrichment-agent.run" },
              { label: "Distributor", event: "app/intel-distributor.run" },
            ].map((a) => (
              <button
                key={a.event}
                type="button"
                disabled={triggerBusy === a.event}
                onClick={() => triggerAgent(a.event)}
                className="rounded-lg border border-slate-600 bg-slate-700 px-2 py-1 text-[10px] font-medium text-slate-300 hover:bg-slate-600 disabled:opacity-50"
              >
                {triggerBusy === a.event ? "..." : a.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-700 text-slate-500">
                <th className="px-2 py-1.5">Agent</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5 text-right">Found</th>
                <th className="px-2 py-1.5 text-right">Added</th>
                <th className="px-2 py-1.5 text-right">Duration</th>
                <th className="px-2 py-1.5">Date</th>
              </tr>
            </thead>
            <tbody>
              {agentRuns.map((r) => (
                <tr key={r.id} className="border-b border-slate-800 hover:bg-slate-700/50">
                  <td className="px-2 py-1.5 text-slate-300">{r.run_type}</td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusColors[r.status] ?? "bg-slate-700 text-slate-400"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right text-slate-300">{r.prospects_found}</td>
                  <td className="px-2 py-1.5 text-right text-slate-300">{r.prospects_added}</td>
                  <td className="px-2 py-1.5 text-right text-slate-400">
                    {r.duration_s != null ? `${r.duration_s}s` : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-slate-500">
                    {new Date(r.started_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                </tr>
              ))}
              {agentRuns.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-4 text-center text-slate-500">
                    No agent runs yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
