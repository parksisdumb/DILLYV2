"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { OppRow, Stage, ScopeType, PropertyOption, OrgUser } from "@/app/app/opportunities/page";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatValue(v: number | null) {
  return v == null ? null : money.format(v);
}

function daysOpen(openedAt: string) {
  return Math.floor((Date.now() - new Date(openedAt).getTime()) / 86400000);
}

function propertyLabel(p: PropertyOption) {
  const addr = [p.address_line1, p.city, p.state].filter(Boolean).join(", ");
  if (p.name && p.name !== p.address_line1) return `${p.name} — ${addr}`;
  return addr;
}

const STATUS_COLORS: Record<string, string> = {
  open: "bg-green-100 text-green-800",
  won: "bg-blue-100 text-blue-800",
  lost: "bg-slate-100 text-slate-600",
};

type Props = {
  opportunities: OppRow[];
  stages: Stage[];
  scopeTypes: ScopeType[];
  properties: PropertyOption[];
  orgUsers: OrgUser[];
  orgId: string;
  userId: string;
  userRole: string;
};

export default function OpportunitiesClient({
  opportunities: initOpps,
  stages,
  scopeTypes,
  properties,
  orgUsers,
  orgId,
  userId,
}: Props) {
  const [opportunities, setOpportunities] = useState<OppRow[]>(initOpps);
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "won" | "lost">("open");
  const [stageFilter, setStageFilter] = useState("");
  const [repFilter, setRepFilter] = useState("");
  const [sort, setSort] = useState<"updated" | "value" | "age">("updated");
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [propId, setPropId] = useState("");
  const [scopeId, setScopeId] = useState("");
  const [stageId, setStageId] = useState("");
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const supabase = createBrowserSupabase();

  // Pipeline summary (full dataset, not filtered)
  const summary = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const open = opportunities.filter((o) => o.status === "open");
    const openValue = open.reduce((s, o) => s + (o.estimated_value ?? 0), 0);
    const wonMTD = opportunities.filter(
      (o) => o.status === "won" && o.closed_at && new Date(o.closed_at) >= monthStart,
    );
    const wonMTDValue = wonMTD.reduce((s, o) => s + (o.estimated_value ?? 0), 0);
    const lostMTD = opportunities.filter(
      (o) => o.status === "lost" && o.closed_at && new Date(o.closed_at) >= monthStart,
    );
    return { openCount: open.length, openValue, wonMTDCount: wonMTD.length, wonMTDValue, lostMTDCount: lostMTD.length };
  }, [opportunities]);

  // Filtered + sorted list
  const filtered = useMemo(() => {
    return opportunities
      .filter(
        (o) =>
          (statusFilter === "all" || o.status === statusFilter) &&
          (!stageFilter || o.stage_id === stageFilter) &&
          (!repFilter || o.primary_rep_user_id === repFilter),
      )
      .sort((a, b) => {
        if (sort === "value") return (b.estimated_value ?? 0) - (a.estimated_value ?? 0);
        if (sort === "age") return new Date(a.opened_at).getTime() - new Date(b.opened_at).getTime();
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      });
  }, [opportunities, statusFilter, stageFilter, repFilter, sort]);

  const openStages = useMemo(() => stages.filter((s) => !s.is_closed_stage), [stages]);
  const repOptions = useMemo(() => {
    const userIds = new Set(opportunities.map((o) => o.primary_rep_user_id).filter(Boolean));
    return orgUsers.filter((u) => userIds.has(u.user_id));
  }, [opportunities, orgUsers]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function resetCreateForm() {
    setPropId("");
    setScopeId("");
    setStageId("");
    setTitle("");
    setValue("");
    setError(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!propId) { setError("Property is required."); return; }
    if (!scopeId) { setError("Scope is required."); return; }
    if (!stageId) { setError("Stage is required."); return; }
    setBusy(true);
    setError(null);

    const { data, error: insertErr } = await supabase
      .from("opportunities")
      .insert({
        org_id: orgId,
        created_by: userId,
        property_id: propId,
        scope_type_id: scopeId,
        stage_id: stageId,
        title: title.trim() || null,
        estimated_value: value ? parseFloat(value) : null,
      })
      .select(
        "id,title,status,estimated_value,stage_id,scope_type_id,property_id,account_id,primary_contact_id,opened_at,closed_at,updated_at",
      )
      .single();

    setBusy(false);
    if (insertErr) { setError(insertErr.message); return; }

    const prop = properties.find((p) => p.id === propId);
    const stage = stages.find((s) => s.id === stageId);
    const scope = scopeTypes.find((s) => s.id === scopeId);

    const newRow: OppRow = {
      id: data.id as string,
      title: data.title as string | null,
      status: "open",
      estimated_value: data.estimated_value as number | null,
      stage_id: data.stage_id as string,
      stage_name: stage?.name ?? "Unknown",
      scope_type_id: data.scope_type_id as string | null,
      scope_name: scope?.name ?? null,
      property_id: data.property_id as string | null,
      property_label: prop ? propertyLabel(prop) : null,
      account_id: data.account_id as string | null,
      account_name: null,
      primary_contact_id: data.primary_contact_id as string | null,
      opened_at: data.opened_at as string,
      closed_at: null,
      updated_at: data.updated_at as string,
      primary_rep_user_id: null,
    };

    setOpportunities((prev) => [newRow, ...prev]);
    resetCreateForm();
    setShowCreate(false);
    showToast("Opportunity created.");
  }

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Opportunities</h1>
        <button
          onClick={() => { setShowCreate((v) => !v); resetCreateForm(); }}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + New Opportunity
        </button>
      </div>

      {/* Pipeline Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-2xl font-bold text-slate-900">{summary.openCount}</div>
          <div className="text-xs text-slate-500">Open</div>
          {summary.openValue > 0 && (
            <div className="mt-1 text-sm font-medium text-slate-700">{formatValue(summary.openValue)} est.</div>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-2xl font-bold text-blue-700">{summary.wonMTDCount}</div>
          <div className="text-xs text-slate-500">Won MTD</div>
          {summary.wonMTDValue > 0 && (
            <div className="mt-1 text-sm font-medium text-blue-700">{formatValue(summary.wonMTDValue)}</div>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-2xl font-bold text-slate-500">{summary.lostMTDCount}</div>
          <div className="text-xs text-slate-500">Lost MTD</div>
        </div>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <h2 className="mb-3 font-semibold text-slate-900">New Opportunity</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            {/* Property */}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Property *</label>
              <select
                value={propId}
                onChange={(e) => setPropId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a property…</option>
                {properties
                  .slice()
                  .sort((a, b) => a.address_line1.localeCompare(b.address_line1))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {propertyLabel(p)}
                    </option>
                  ))}
              </select>
            </div>

            {/* Scope */}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Scope *</label>
              <div className="flex flex-wrap gap-2">
                {scopeTypes.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setScopeId(s.id)}
                    className={`rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${
                      scopeId === s.id
                        ? "bg-blue-600 text-white"
                        : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Stage */}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Stage *</label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a stage…</option>
                {openStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Title + Value */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Title (optional)</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. TPO Replacement"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Est. Value</label>
                <input
                  type="number"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="0"
                  min="0"
                  step="1000"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create Opportunity"}
              </button>
              <button
                type="button"
                onClick={() => { setShowCreate(false); resetCreateForm(); }}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Status tabs */}
        {(["all", "open", "won", "lost"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-xl px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
              statusFilter === s
                ? "bg-slate-900 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}

        <div className="ml-auto flex flex-wrap gap-2">
          {/* Stage filter */}
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:outline-none"
          >
            <option value="">All Stages</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {/* Rep filter */}
          {repOptions.length > 0 && (
            <select
              value={repFilter}
              onChange={(e) => setRepFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:outline-none"
            >
              <option value="">All Reps</option>
              {repOptions.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.user_id.slice(0, 8)}…
                </option>
              ))}
            </select>
          )}

          {/* Sort */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "updated" | "value" | "age")}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:outline-none"
          >
            <option value="updated">Recently Updated</option>
            <option value="value">Highest Value</option>
            <option value="age">Oldest First</option>
          </select>
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No opportunities match your filters.
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-medium">Property</th>
                  <th className="px-4 py-3 font-medium">Account</th>
                  <th className="px-4 py-3 font-medium">Scope · Stage</th>
                  <th className="px-4 py-3 font-medium">Est. Value</th>
                  <th className="px-4 py-3 font-medium">Age</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr
                    key={o.id}
                    className="cursor-pointer border-b border-slate-100 text-slate-700 transition-colors last:border-0 hover:bg-slate-50"
                    onClick={() => (window.location.href = `/app/opportunities/${o.id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {o.property_label ?? <span className="text-slate-400">No property</span>}
                    </td>
                    <td className="px-4 py-3">{o.account_name ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-3">
                      <span className="text-slate-600">{o.scope_name ?? "—"}</span>
                      {o.scope_name && <span className="mx-1 text-slate-300">·</span>}
                      <span>{o.stage_name}</span>
                    </td>
                    <td className="px-4 py-3">{formatValue(o.estimated_value) ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {o.status === "open" ? `${daysOpen(o.opened_at)}d` : o.closed_at ? new Date(o.closed_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_COLORS[o.status] ?? ""}`}>
                        {o.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {filtered.map((o) => (
              <Link
                key={o.id}
                href={`/app/opportunities/${o.id}`}
                className="block rounded-2xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">{o.scope_name ?? "Opportunity"}</div>
                    <div className="text-sm text-slate-600">{o.property_label ?? "No property"}</div>
                    {o.account_name && <div className="text-sm text-slate-500">{o.account_name}</div>}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_COLORS[o.status] ?? ""}`}>
                    {o.status}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                  <span>{o.stage_name}</span>
                  <span>·</span>
                  <span>
                    {o.status === "open"
                      ? `${daysOpen(o.opened_at)} days open`
                      : o.closed_at
                        ? `Closed ${new Date(o.closed_at).toLocaleDateString()}`
                        : ""}
                  </span>
                  {o.estimated_value != null && (
                    <>
                      <span>·</span>
                      <span className="font-medium text-slate-700">{formatValue(o.estimated_value)}</span>
                    </>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
