"use client";

import { useState } from "react";
import Link from "next/link";
import type { AgentRun } from "./page";

const STATUS_STYLES: Record<string, string> = {
  running: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

const SOURCE_LABELS: Record<string, string> = {
  sec_edgar: "SEC EDGAR",
  openstreetmap: "OpenStreetMap",
  web_intelligence: "Web Intelligence",
  // TODO: Add BatchData label when source is implemented
  // batchdata: "BatchData",
  // TODO: Add PropTracer label when source is implemented
  // proptracer: "PropTracer",
};

function formatDuration(start: string, end: string | null): string {
  if (!end) return "Running...";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function AgentClient({
  runs,
  agentProspectCount,
}: {
  runs: AgentRun[];
  agentProspectCount: number;
}) {
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);

  const lastRun = runs[0] ?? null;
  const isRunning = lastRun?.status === "running";

  async function handleTrigger() {
    setTriggering(true);
    setTriggerResult(null);

    try {
      const res = await fetch("/api/agent/trigger", { method: "POST" });
      const data = await res.json();

      if (res.ok) {
        setTriggerResult("Agent started. Refresh in a few minutes to see results.");
      } else {
        setTriggerResult(data.error || "Failed to trigger agent");
      }
    } catch {
      setTriggerResult("Network error — could not trigger agent");
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Prospecting Agent
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            AI-powered lead discovery from public data sources
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/app/manager/prospects?source=agent"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Agent Prospects ({agentProspectCount})
          </Link>
          <button
            type="button"
            onClick={handleTrigger}
            disabled={triggering || isRunning}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {triggering ? "Starting..." : isRunning ? "Running..." : "Run Now"}
          </button>
        </div>
      </div>

      {triggerResult && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
          {triggerResult}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Total Runs</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">
            {runs.length}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Prospects Found
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900">
            {runs.reduce((s, r) => s + r.prospects_found, 0)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Prospects Added
          </div>
          <div className="mt-1 text-2xl font-bold text-green-600">
            {runs.reduce((s, r) => s + r.prospects_added, 0)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Duplicates Skipped
          </div>
          <div className="mt-1 text-2xl font-bold text-amber-600">
            {runs.reduce((s, r) => s + r.prospects_skipped_dedup, 0)}
          </div>
        </div>
      </div>

      {/* Last run info */}
      {lastRun && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Last Run</div>
          <div className="mt-1 text-sm text-slate-700">
            {formatTime(lastRun.started_at)} —{" "}
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[lastRun.status] ?? "bg-slate-100 text-slate-600"}`}
            >
              {lastRun.status}
            </span>{" "}
            — Duration: {formatDuration(lastRun.started_at, lastRun.completed_at)}
          </div>
          {lastRun.error_message && (
            <div className="mt-2 text-sm text-red-600">
              {lastRun.error_message}
            </div>
          )}
        </div>
      )}

      {/* Run history */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Run History
        </h2>

        {runs.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">
            No agent runs yet. Click &quot;Run Now&quot; to start the
            prospecting agent.
          </p>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs font-semibold uppercase text-slate-400">
                    <th className="whitespace-nowrap px-3 py-2">Date</th>
                    <th className="whitespace-nowrap px-3 py-2">Status</th>
                    <th className="whitespace-nowrap px-3 py-2">Found</th>
                    <th className="whitespace-nowrap px-3 py-2">Added</th>
                    <th className="whitespace-nowrap px-3 py-2">Skipped</th>
                    <th className="whitespace-nowrap px-3 py-2">Duration</th>
                    <th className="whitespace-nowrap px-3 py-2">Sources</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-slate-50 hover:bg-slate-50"
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                        {formatTime(r.started_at)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[r.status] ?? "bg-slate-100 text-slate-600"}`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {r.prospects_found}
                      </td>
                      <td className="px-3 py-2 font-semibold text-green-600">
                        {r.prospects_added}
                      </td>
                      <td className="px-3 py-2 text-amber-600">
                        {r.prospects_skipped_dedup}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                        {formatDuration(r.started_at, r.completed_at)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(r.source_breakdown).map(
                            ([key, val]) => (
                              <span
                                key={key}
                                className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                                title={`Found: ${val.found}, Added: ${val.added}, Skipped: ${val.skipped}`}
                              >
                                {SOURCE_LABELS[key] ?? key}: {val.added}
                              </span>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="space-y-3 sm:hidden">
              {runs.map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl border border-slate-100 bg-slate-50 p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">
                      {formatTime(r.started_at)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[r.status] ?? "bg-slate-100 text-slate-600"}`}
                    >
                      {r.status}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-600">
                    <span>Found: {r.prospects_found}</span>
                    <span className="text-green-600">
                      Added: {r.prospects_added}
                    </span>
                    <span className="text-amber-600">
                      Skipped: {r.prospects_skipped_dedup}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    Duration: {formatDuration(r.started_at, r.completed_at)}
                  </div>
                  {r.error_message && (
                    <div className="mt-1 text-xs text-red-600">
                      {r.error_message}
                    </div>
                  )}
                  {Object.keys(r.source_breakdown).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {Object.entries(r.source_breakdown).map(
                        ([key, val]) => (
                          <span
                            key={key}
                            className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500"
                          >
                            {SOURCE_LABELS[key] ?? key}: {val.added}
                          </span>
                        )
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
