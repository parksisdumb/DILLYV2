"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { ReviewProspect, OrgRep } from "./page";

const SOURCE_LABELS: Record<string, string> = {
  edgar_10k_address: "EDGAR",
  google_places: "Google Places",
  cms_healthcare: "CMS",
  web_intelligence: "Web Intel",
};

export default function ReviewClient({
  prospects,
  reps,
  orgId,
  managerId,
}: {
  prospects: ReviewProspect[];
  reps: OrgRep[];
  orgId: string;
  managerId: string;
}) {
  const router = useRouter();
  const [sourceFilter, setSourceFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [scoreMin, setScoreMin] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const filtered = prospects.filter((p) => {
    if (dismissed.has(p.id)) return false;
    if (sourceFilter !== "all" && p.source_detail !== sourceFilter) return false;
    if (stateFilter !== "all" && p.state?.toUpperCase() !== stateFilter) return false;
    if ((p.confidence_score ?? 0) < scoreMin) return false;
    return true;
  });

  const sources = [...new Set(prospects.map((p) => p.source_detail).filter(Boolean))] as string[];
  const states = [...new Set(prospects.map((p) => p.state?.toUpperCase()).filter(Boolean))] as string[];

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((p) => p.id)));
    }
  }

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  async function assignToRep(prospectIds: string[], repId: string) {
    setBusy(true);
    try {
      const resp = await fetch("/api/intel/assign-prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_id: orgId,
          manager_id: managerId,
          prospect_ids: prospectIds,
          rep_user_id: repId,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        showToast(`Error: ${text}`);
        return;
      }

      const data = await resp.json();
      showToast(`Assigned ${data.assigned} prospect${data.assigned !== 1 ? "s" : ""}`);
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function dismissProspects(prospectIds: string[]) {
    setBusy(true);
    try {
      const resp = await fetch("/api/intel/dismiss-prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_id: orgId,
          prospect_ids: prospectIds,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        showToast(`Error: ${text}`);
        return;
      }

      const data = await resp.json();
      showToast(`Dismissed ${data.dismissed} prospect${data.dismissed !== 1 ? "s" : ""}`);
      setDismissed((prev) => {
        const next = new Set(prev);
        for (const id of prospectIds) next.add(id);
        return next;
      });
      setSelected(new Set());
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  function scoreBadge(score: number | null) {
    const s = score ?? 0;
    const color =
      s >= 60
        ? "bg-green-100 text-green-700"
        : s >= 40
          ? "bg-amber-100 text-amber-700"
          : "bg-slate-100 text-slate-500";
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
        {s}
      </span>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* Toast */}
      {toast && (
        <div className="fixed right-4 top-4 z-50 rounded-xl border border-green-200 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">New Prospects</h1>
            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-sm font-semibold text-blue-700">
              {filtered.length}
            </span>
          </div>
          <p className="text-sm text-slate-500">
            Agent-sourced prospects ready for rep assignment
          </p>
        </div>
      </div>

      {/* Filters + bulk actions */}
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

        {/* Bulk actions */}
        {selected.size > 0 && (
          <>
            <div className="flex items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
              <span className="text-xs font-medium text-blue-700">
                {selected.size} selected
              </span>
              {reps.length > 0 && (
                <select
                  disabled={busy}
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      assignToRep([...selected], e.target.value);
                      e.target.value = "";
                    }
                  }}
                  className="ml-1 rounded-lg border-0 bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700"
                >
                  <option value="" disabled>
                    Assign to...
                  </option>
                  {reps.map((r) => (
                    <option key={r.user_id} value={r.user_id}>
                      {r.full_name || r.email}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => dismissProspects([...selected])}
                className="ml-1 rounded-lg bg-red-100 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-200 disabled:opacity-50"
              >
                Dismiss
              </button>
            </div>
          </>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm text-slate-500">
            No new prospects. The intel pipeline runs weekly — check back Monday
            or trigger a manual run from the Agent page.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white sm:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs font-semibold uppercase text-slate-400">
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={toggleAll}
                      className="rounded"
                    />
                  </th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2 text-center">Score</th>
                  <th className="px-3 py-2">Added</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map((p) => (
                  <tr
                    key={p.id}
                    className={`border-b border-slate-50 hover:bg-slate-50 ${selected.has(p.id) ? "bg-blue-50" : ""}`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="rounded"
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <div className="font-medium text-slate-900">
                        {p.company_name}
                      </div>
                      {p.address_line1 && (
                        <div className="text-xs text-slate-400">
                          {p.address_line1}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {[p.city, p.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        {SOURCE_LABELS[p.source_detail ?? ""] ?? p.source_detail}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {scoreBadge(p.confidence_score)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400">
                      {new Date(p.created_at).toLocaleDateString()}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {reps.length > 0 && (
                          <select
                            disabled={busy}
                            defaultValue=""
                            onChange={(e) => {
                              if (e.target.value) {
                                assignToRep([p.id], e.target.value);
                                e.target.value = "";
                              }
                            }}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                          >
                            <option value="" disabled>
                              Assign
                            </option>
                            {reps.map((r) => (
                              <option key={r.user_id} value={r.user_id}>
                                {r.full_name || r.email}
                              </option>
                            ))}
                          </select>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => dismissProspects([p.id])}
                          className="rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-50"
                        >
                          Dismiss
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 100 && (
              <div className="border-t border-slate-100 px-3 py-2 text-center text-xs text-slate-400">
                Showing first 100 of {filtered.length}
              </div>
            )}
          </div>

          {/* Mobile */}
          <div className="space-y-2 sm:hidden">
            {filtered.slice(0, 50).map((p) => (
              <div
                key={p.id}
                className={`rounded-xl border bg-white p-3 ${selected.has(p.id) ? "border-blue-300 bg-blue-50" : "border-slate-200"}`}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggleSelect(p.id)}
                    className="mt-1 rounded"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">
                        {p.company_name}
                      </span>
                      {scoreBadge(p.confidence_score)}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {[p.address_line1, p.city, p.state]
                        .filter(Boolean)
                        .join(", ") || "No address"}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        {SOURCE_LABELS[p.source_detail ?? ""] ?? p.source_detail}
                      </span>
                      {reps.length > 0 && (
                        <select
                          disabled={busy}
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) {
                              assignToRep([p.id], e.target.value);
                              e.target.value = "";
                            }
                          }}
                          className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700"
                        >
                          <option value="" disabled>
                            Assign
                          </option>
                          {reps.map((r) => (
                            <option key={r.user_id} value={r.user_id}>
                              {r.full_name || r.email}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => dismissProspects([p.id])}
                        className="text-xs text-red-500"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
