"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  PROSPECT_STATUS_LABELS,
  PROSPECT_STATUS_COLORS,
} from "@/lib/constants/prospect-fields";

// ── Types ───────────────────────────────────────────────────────────────────

type ProspectRow = {
  id: string;
  company_name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  account_type: string | null;
  vertical: string | null;
  status: string;
  territory_id: string | null;
  territory_name: string | null;
  source: string;
  source_detail: string | null;
  confidence_score: number;
  notes: string | null;
  created_at: string;
  assigned_to: string | null;
};

type TerritoryOption = { id: string; name: string };
type OrgUserOption = { id: string; full_name: string | null; email: string | null };

type RepQueueCount = { name: string; count: number };

type SuggestedRow = {
  id: string;
  prospect_id: string;
  rep_name: string;
  status: string;
  company_name: string;
  city: string | null;
  state: string | null;
};

type Props = {
  prospects: ProspectRow[];
  territories: TerritoryOption[];
  orgUsers: OrgUserOption[];
  repQueueCounts: RepQueueCount[];
  unassignedCount: number;
  assignedRows: SuggestedRow[];
  bulkUpdateStatusAction: (formData: FormData) => Promise<void>;
  assignToRepAction: (formData: FormData) => Promise<void>;
};

type Sort = "newest" | "company" | "city";

// ── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  owner: "Owner",
  commercial_property_management: "Property Mgmt",
  facilities_management: "Facilities",
  asset_management: "Asset Mgmt",
  general_contractor: "GC",
  developer: "Developer",
  broker: "Broker",
  consultant: "Consultant",
  vendor: "Vendor",
  other: "Other",
};

const input =
  "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
  const label = PROSPECT_STATUS_LABELS[status] ?? status;
  const color = PROSPECT_STATUS_COLORS[status] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>{label}</span>
  );
}

function location(p: ProspectRow): string {
  const parts: string[] = [];
  if (p.city) parts.push(p.city);
  if (p.state) parts.push(p.state);
  return parts.join(", ") || "—";
}

// ── Component ───────────────────────────────────────────────────────────────

export default function ProspectsClient({ prospects, territories, orgUsers, repQueueCounts, unassignedCount, assignedRows, bulkUpdateStatusAction, assignToRepAction }: Props) {
  const [activeTab, setActiveTab] = useState<"assign" | "assigned" | "all">("assign");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [territoryFilter, setTerritoryFilter] = useState("");
  const [accountTypeFilter, setAccountTypeFilter] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [assignRepId, setAssignRepId] = useState("");
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const bulkFormRef = useRef<HTMLFormElement>(null);
  const assignFormRef = useRef<HTMLFormElement>(null);

  function showToast(tone: "success" | "error", text: string) {
    setToast({ tone, text });
    setTimeout(() => setToast((prev) => (prev?.text === text ? null : prev)), 2500);
  }

  // ── Filtered + sorted list ──
  const filtered = useMemo(() => {
    let rows = prospects;
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (p) =>
          p.company_name.toLowerCase().includes(q) ||
          (p.city ?? "").toLowerCase().includes(q) ||
          (p.email ?? "").toLowerCase().includes(q) ||
          (p.state ?? "").toLowerCase().includes(q)
      );
    }
    if (statusFilter) rows = rows.filter((p) => p.status === statusFilter);
    if (territoryFilter) rows = rows.filter((p) => p.territory_id === territoryFilter);
    if (accountTypeFilter) rows = rows.filter((p) => p.account_type === accountTypeFilter);

    return [...rows].sort((a, b) => {
      if (sort === "company") return a.company_name.localeCompare(b.company_name);
      if (sort === "city") return (a.city ?? "").localeCompare(b.city ?? "");
      return b.created_at.localeCompare(a.created_at);
    });
  }, [prospects, search, statusFilter, territoryFilter, accountTypeFilter, sort]);

  // ── Selection ──
  const allSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));
  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((p) => p.id)));
    }
  }
  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── Bulk action ──
  async function submitBulk(newStatus: string) {
    if (!bulkFormRef.current || selectedIds.size === 0) return;
    setBulkBusy(true);
    const form = bulkFormRef.current;
    const idsInput = form.querySelector<HTMLInputElement>('input[name="ids"]');
    const statusInput = form.querySelector<HTMLInputElement>('input[name="status"]');
    if (idsInput) idsInput.value = JSON.stringify([...selectedIds]);
    if (statusInput) statusInput.value = newStatus;
    form.requestSubmit();
  }

  // ── Assign to rep ──
  function submitAssign() {
    if (!assignFormRef.current || selectedIds.size === 0 || !assignRepId) return;
    setBulkBusy(true);
    const form = assignFormRef.current;
    const idsInput = form.querySelector<HTMLInputElement>('input[name="ids"]');
    const userInput = form.querySelector<HTMLInputElement>('input[name="user_id"]');
    if (idsInput) idsInput.value = JSON.stringify([...selectedIds]);
    if (userInput) userInput.value = assignRepId;
    form.requestSubmit();
  }

  // ── Unique account types for filter ──
  const accountTypes = useMemo(() => {
    const set = new Set<string>();
    for (const p of prospects) if (p.account_type) set.add(p.account_type);
    return [...set].sort();
  }, [prospects]);

  const STATUSES = ["unworked", "queued", "converted", "dismissed"];

  const STATUS_BADGE: Record<string, string> = {
    new: "bg-blue-100 text-blue-700",
    accepted: "bg-green-100 text-green-700",
    dismissed: "bg-slate-100 text-slate-500",
    converted: "bg-purple-100 text-purple-700",
  };

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Prospects</h1>
        <Link
          href="/app/manager/prospects/import"
          className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Import CSV
        </Link>
      </div>

      {/* ── Tabs ── */}
      <div className="flex overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {([
          { key: "assign" as const, label: "To Assign", count: unassignedCount },
          { key: "assigned" as const, label: "Assigned", count: assignedRows.length },
          { key: "all" as const, label: "All Prospects", count: prospects.length },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`shrink-0 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === t.key
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
            <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* ── Tab: Assigned ── */}
      {activeTab === "assigned" && (
        <div className="space-y-2">
          {assignedRows.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
              No prospects have been assigned yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs font-semibold uppercase text-slate-400">
                    <th className="px-3 py-2">Company</th>
                    <th className="px-3 py-2">Location</th>
                    <th className="px-3 py-2">Rep</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {assignedRows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900">{r.company_name}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                        {[r.city, r.state].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.rep_name}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[r.status] ?? "bg-slate-100 text-slate-500"}`}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: All Prospects (existing content) ── */}
      {activeTab !== "assigned" && <>

      {/* ── Rep queue summary ── */}
      {repQueueCounts.some((r) => r.count > 0) && (
        <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
          <span className="text-xs font-semibold text-slate-600 self-center">Active queues:</span>
          {repQueueCounts.map((r) => (
            <span
              key={r.name}
              className={[
                "rounded-lg px-2 py-0.5 text-xs font-medium",
                r.count > 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400",
              ].join(" ")}
            >
              {r.name}: {r.count}
            </span>
          ))}
        </div>
      )}

      {/* ── Search + filters ── */}
      <div className="flex flex-wrap gap-2">
        <input
          className={[input, "min-w-[180px] flex-1"].join(" ")}
          placeholder="Search company, city, email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="h-10 rounded-xl border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
        >
          <option value="newest">Newest</option>
          <option value="company">Company A–Z</option>
          <option value="city">City A–Z</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        {territories.length > 0 && (
          <select
            className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-blue-500 focus:outline-none"
            value={territoryFilter}
            onChange={(e) => setTerritoryFilter(e.target.value)}
          >
            <option value="">All Territories</option>
            {territories.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
        {accountTypes.length > 0 && (
          <select
            className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-blue-500 focus:outline-none"
            value={accountTypeFilter}
            onChange={(e) => setAccountTypeFilter(e.target.value)}
          >
            <option value="">All Types</option>
            {accountTypes.map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>
            ))}
          </select>
        )}
      </div>

      {/* ── Status chips ── */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {["", ...STATUSES].map((s) => {
          const active = statusFilter === s;
          return (
            <button
              key={s || "__all__"}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={[
                "shrink-0 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
              ].join(" ")}
            >
              {s ? (PROSPECT_STATUS_LABELS[s] ?? s) : "All"}
            </button>
          );
        })}
      </div>

      {/* ── Bulk action bar ── */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2">
          <span className="text-sm font-medium text-blue-700">
            {selectedIds.size} selected
          </span>
          <div className="flex-1" />
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => void submitBulk("queued")}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Queue
          </button>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => void submitBulk("dismissed")}
            className="rounded-lg bg-slate-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={() => setShowAssign(!showAssign)}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            Assign to Rep
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            Clear
          </button>
        </div>
      )}

      {/* Assign to rep inline */}
      {showAssign && selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2">
          <span className="text-sm font-medium text-emerald-700">Assign to:</span>
          <select
            className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
            value={assignRepId}
            onChange={(e) => setAssignRepId(e.target.value)}
          >
            <option value="">Select rep...</option>
            {orgUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name ?? u.email ?? u.id}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!assignRepId || bulkBusy}
            onClick={() => submitAssign()}
            className={[
              "rounded-lg px-3 py-1.5 text-xs font-semibold",
              assignRepId
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-slate-100 text-slate-400",
            ].join(" ")}
          >
            {bulkBusy ? "Assigning..." : "Confirm"}
          </button>
          <button
            type="button"
            onClick={() => { setShowAssign(false); setAssignRepId(""); }}
            className="text-xs text-slate-400 hover:text-slate-600"
          >
            Cancel
          </button>
        </div>
      )}

      {/* hidden form for bulk server action */}
      <form ref={bulkFormRef} action={bulkUpdateStatusAction} className="hidden">
        <input type="hidden" name="ids" value="[]" />
        <input type="hidden" name="status" value="" />
      </form>

      {/* hidden form for assign action */}
      <form ref={assignFormRef} action={assignToRepAction} className="hidden">
        <input type="hidden" name="ids" value="[]" />
        <input type="hidden" name="user_id" value="" />
      </form>

      {/* ── Empty state ── */}
      {filtered.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="text-sm text-slate-500">
            {search || statusFilter || territoryFilter || accountTypeFilter
              ? "No prospects match your filters."
              : "No prospects yet. Import a CSV to get started."}
          </div>
        </div>
      )}

      {/* ── Desktop table ── */}
      {filtered.length > 0 && (
        <>
          <div className="hidden md:block rounded-2xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Territory</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Assigned</th>
                  <th className="px-4 py-3 font-medium">Added</th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.id)}
                        onChange={() => toggleOne(row.id)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {row.company_name}
                      {row.account_type && (
                        <span className="ml-2 text-xs text-slate-400">
                          {TYPE_LABELS[row.account_type] ?? row.account_type}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.email ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{location(row)}</td>
                    <td className="px-4 py-3 text-slate-600">{row.territory_name ?? "—"}</td>
                    <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                    <td className="px-4 py-3">
                      {row.assigned_to ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          {row.assigned_to}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(row.created_at)}</td>
                    <td className="px-4 py-3">
                      {row.status !== "converted" && (
                        <Link
                          href={`/app/manager/prospects/convert/${row.id}`}
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
                        >
                          Convert
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Mobile card list ── */}
          <div className="md:hidden space-y-3">
            {filtered.map((row) => (
              <div
                key={row.id}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(row.id)}
                    onChange={() => toggleOne(row.id)}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{row.company_name}</span>
                      <StatusBadge status={row.status} />
                      {row.assigned_to && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          {row.assigned_to}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {location(row)}
                      {row.territory_name && ` · ${row.territory_name}`}
                      {row.email && ` · ${row.email}`}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      Added {formatDate(row.created_at)}
                      {row.source === "csv_import" && row.source_detail && ` via ${row.source_detail}`}
                    </div>
                    {row.status !== "converted" && (
                      <Link
                        href={`/app/manager/prospects/convert/${row.id}`}
                        className="mt-2 inline-block rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
                      >
                        Convert to Account
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div
          className={[
            "fixed bottom-20 right-4 z-60 rounded-lg border px-3 py-2 text-sm shadow md:bottom-4",
            toast.tone === "success"
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700",
          ].join(" ")}
        >
          {toast.text}
        </div>
      )}

      </>}
    </div>
  );
}
