"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { createBrowserSupabase } from "@/lib/supabase/browser";

// ── Types ──────────────────────────────────────────────────────────────────

type AccountRow = {
  id: string;
  name: string | null;
  account_type: string | null;
  status: string;
  notes: string | null;
  website: string | null;
  phone: string | null;
  updated_at: string;
  created_by: string | null;
  contact_count: number;
  opportunity_count: number;
  last_touch_at: string | null;
};

type PropertyOption = {
  id: string;
  address_line1: string;
  city: string | null;
  state: string | null;
  postal_code: string | null;
};

type Props = {
  accounts: AccountRow[];
  orgId: string;
  userId: string;
  userRole: string;
  allProperties: PropertyOption[];
};

type Sort = "last_touched" | "name" | "most_contacts" | "most_opportunities";

// ── Constants ──────────────────────────────────────────────────────────────

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

const ACCOUNT_TYPES = Object.keys(TYPE_LABELS);

const TYPE_COLORS: Record<string, string> = {
  owner: "bg-purple-100 text-purple-700",
  commercial_property_management: "bg-blue-100 text-blue-700",
  facilities_management: "bg-cyan-100 text-cyan-700",
  asset_management: "bg-indigo-100 text-indigo-700",
  general_contractor: "bg-orange-100 text-orange-700",
  developer: "bg-green-100 text-green-700",
  broker: "bg-yellow-100 text-yellow-700",
  consultant: "bg-rose-100 text-rose-700",
  vendor: "bg-slate-100 text-slate-700",
  other: "bg-slate-100 text-slate-600",
};

// ── Helpers ────────────────────────────────────────────────────────────────

const input =
  "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none";

const sectionLabel = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function TypeBadge({ type }: { type: string | null }) {
  if (!type) return null;
  const label = TYPE_LABELS[type] ?? type;
  const color = TYPE_COLORS[type] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>{label}</span>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function AccountsClient({ accounts: initialAccounts, orgId, userId, userRole, allProperties }: Props) {
  const supabase = useMemo(() => createBrowserSupabase(), []);

  // ── List state ──
  const [accounts, setAccounts] = useState<AccountRow[]>(initialAccounts);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sort, setSort] = useState<Sort>("last_touched");

  // ── Create form state ──
  const [showCreate, setShowCreate] = useState(false);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("");
  const [formWebsite, setFormWebsite] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formPropertyId, setFormPropertyId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);

  // ── Delete state ──
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // ── Toast ──
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  function showToast(tone: "success" | "error", text: string) {
    setToast({ tone, text });
    setTimeout(() => setToast((prev) => (prev?.text === text ? null : prev)), 2500);
  }

  // ── Filtered + sorted list ──
  const filtered = useMemo(() => {
    let rows = accounts;
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((a) => (a.name ?? "").toLowerCase().includes(q));
    if (typeFilter) rows = rows.filter((a) => a.account_type === typeFilter);

    return [...rows].sort((a, b) => {
      if (sort === "name") return (a.name ?? "").localeCompare(b.name ?? "");
      if (sort === "most_contacts") return b.contact_count - a.contact_count;
      if (sort === "most_opportunities") return b.opportunity_count - a.opportunity_count;
      // last_touched: nulls last, then descending
      if (!a.last_touch_at && !b.last_touch_at) return 0;
      if (!a.last_touch_at) return 1;
      if (!b.last_touch_at) return -1;
      return b.last_touch_at.localeCompare(a.last_touch_at);
    });
  }, [accounts, search, typeFilter, sort]);

  // ── Can user delete this row? ──
  function canDelete(row: AccountRow): boolean {
    return userRole === "manager" || userRole === "admin" || row.created_by === userId;
  }

  // ── Create account ──
  async function onCreateSubmit() {
    if (!formName.trim()) { setFormError("Account name is required."); return; }
    if (!formType) { setFormError("Account type is required."); return; }
    setFormError(null);
    setCreateBusy(true);

    const { data, error } = await supabase
      .from("accounts")
      .insert({
        org_id: orgId,
        created_by: userId,
        name: formName.trim(),
        account_type: formType,
        website: formWebsite.trim() || null,
        phone: formPhone.trim() || null,
        notes: formNotes.trim() || null,
      })
      .select("id,name,account_type,status,notes,website,phone,updated_at,created_by")
      .single();

    setCreateBusy(false);

    if (error) { setFormError(error.message); return; }

    const newRow: AccountRow = {
      id: (data as Record<string, unknown>).id as string,
      name: (data as Record<string, unknown>).name as string | null,
      account_type: (data as Record<string, unknown>).account_type as string | null,
      status: ((data as Record<string, unknown>).status as string) ?? "active",
      notes: (data as Record<string, unknown>).notes as string | null,
      website: (data as Record<string, unknown>).website as string | null ?? null,
      phone: (data as Record<string, unknown>).phone as string | null ?? null,
      updated_at: (data as Record<string, unknown>).updated_at as string,
      created_by: (data as Record<string, unknown>).created_by as string | null,
      contact_count: 0,
      opportunity_count: 0,
      last_touch_at: null,
    };

    // Link property if selected
    if (formPropertyId) {
      await supabase
        .from("properties")
        .update({ primary_account_id: newRow.id })
        .eq("id", formPropertyId);
    }

    setAccounts((prev) => [newRow, ...prev]);
    setShowCreate(false);
    setFormName(""); setFormType(""); setFormWebsite(""); setFormPhone(""); setFormNotes(""); setFormPropertyId("");
    showToast("success", `${newRow.name ?? "Account"} created.`);
  }

  // ── Soft delete ──
  async function onDeleteConfirm(id: string) {
    setDeleteBusy(true);
    const { error } = await supabase
      .from("accounts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    setDeleteBusy(false);

    if (error) { showToast("error", error.message); return; }

    const deleted = accounts.find((a) => a.id === id);
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    setDeleteConfirmId(null);
    showToast("success", `${deleted?.name ?? "Account"} deleted.`);
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Accounts</h1>
        <div className="flex gap-2">
          <Link
            href="/app/accounts/discover"
            className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            Find in Territory
          </Link>
          <button
            type="button"
            onClick={() => { setShowCreate(!showCreate); setFormError(null); }}
            className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            {showCreate ? "Cancel" : "+ New Account"}
          </button>
        </div>
      </div>

      {/* ── Create form ── */}
      {showCreate && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            New Account
          </div>

          {formError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className={sectionLabel}>Company Name *</label>
              <input
                className={input}
                placeholder="Acme Roofing"
                value={formName}
                onChange={(e) => { setFormName(e.target.value); setFormError(null); }}
              />
            </div>
            <div>
              <label className={sectionLabel}>Account Type *</label>
              <select
                className={input}
                value={formType}
                onChange={(e) => { setFormType(e.target.value); setFormError(null); }}
              >
                <option value="">Select type...</option>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={sectionLabel}>Website</label>
              <input
                className={input}
                placeholder="https://acme.com"
                type="url"
                value={formWebsite}
                onChange={(e) => setFormWebsite(e.target.value)}
              />
            </div>
            <div>
              <label className={sectionLabel}>Phone</label>
              <input
                className={input}
                placeholder="(555) 000-0000"
                type="tel"
                value={formPhone}
                onChange={(e) => setFormPhone(e.target.value)}
              />
            </div>
            {allProperties.length > 0 && (
              <div>
                <label className={sectionLabel}>Link Property</label>
                <select
                  className={input}
                  value={formPropertyId}
                  onChange={(e) => setFormPropertyId(e.target.value)}
                >
                  <option value="">None</option>
                  {allProperties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.address_line1}{p.city ? `, ${p.city}` : ""}{p.state ? ` ${p.state}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={allProperties.length > 0 ? "" : "md:col-span-2"}>
              <label className={sectionLabel}>Notes</label>
              <input
                className={input}
                placeholder="Any context about this account..."
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </div>
          </div>

          <button
            type="button"
            disabled={createBusy}
            onClick={() => void onCreateSubmit()}
            className={[
              "rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
              formName.trim() && formType
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-slate-100 text-slate-400",
            ].join(" ")}
          >
            {createBusy ? "Saving..." : "Create Account"}
          </button>
        </div>
      )}

      {/* ── Search + sort bar ── */}
      <div className="flex gap-2">
        <input
          className={[input, "flex-1"].join(" ")}
          placeholder="Search accounts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="h-10 rounded-xl border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
        >
          <option value="last_touched">Last Touched</option>
          <option value="name">Name A–Z</option>
          <option value="most_contacts">Most Contacts</option>
          <option value="most_opportunities">Most Opps</option>
        </select>
      </div>

      {/* ── Type filter chips ── */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {["", ...ACCOUNT_TYPES].map((t) => {
          const active = typeFilter === t;
          return (
            <button
              key={t || "__all__"}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={[
                "shrink-0 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
              ].join(" ")}
            >
              {t ? (TYPE_LABELS[t] ?? t) : "All"}
            </button>
          );
        })}
      </div>

      {/* ── Empty state ── */}
      {filtered.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="text-sm text-slate-500">
            {search || typeFilter ? "No accounts match your filters." : "No accounts yet."}
          </div>
        </div>
      )}

      {/* ── Desktop table ── */}
      {filtered.length > 0 && (
        <>
          <div className="hidden md:block rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Contacts</th>
                  <th className="px-4 py-3 font-medium">Opps</th>
                  <th className="px-4 py-3 font-medium">Last Touch</th>
                  <th className="px-4 py-3 font-medium w-10" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <Fragment key={row.id}>
                    <tr
                      className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                      onClick={() => { window.location.href = `/app/accounts/${row.id}`; }}
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">{row.name ?? "—"}</td>
                      <td className="px-4 py-3">
                        <TypeBadge type={row.account_type} />
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.contact_count}</td>
                      <td className="px-4 py-3 text-slate-600">{row.opportunity_count}</td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(row.last_touch_at)}</td>
                      <td className="px-4 py-3">
                        {canDelete(row) && deleteConfirmId !== row.id && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(row.id); }}
                            className="rounded-lg p-1 text-slate-300 hover:bg-red-50 hover:text-red-500"
                            aria-label="Delete"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </td>
                    </tr>
                    {deleteConfirmId === row.id && (
                      <tr className="bg-red-50">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-slate-700">
                              Delete <strong>{row.name}</strong>?
                            </span>
                            <button
                              type="button"
                              disabled={deleteBusy}
                              onClick={() => void onDeleteConfirm(row.id)}
                              className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              {deleteBusy ? "Deleting..." : "Delete"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(null)}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Mobile card list ── */}
          <div className="md:hidden space-y-3">
            {filtered.map((row) => (
              <div
                key={row.id}
                className="cursor-pointer rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm hover:border-slate-300 hover:bg-slate-50"
                onClick={() => { window.location.href = `/app/accounts/${row.id}`; }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{row.name ?? "—"}</span>
                      <TypeBadge type={row.account_type} />
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {row.contact_count} contact{row.contact_count !== 1 ? "s" : ""}
                      {row.opportunity_count > 0 && ` · ${row.opportunity_count} opp${row.opportunity_count !== 1 ? "s" : ""}`}
                      {row.last_touch_at && ` · Last touch: ${formatDate(row.last_touch_at)}`}
                    </div>
                  </div>
                  {canDelete(row) && deleteConfirmId !== row.id && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(row.id); }}
                      className="shrink-0 rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"
                      aria-label="Delete"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>

                {deleteConfirmId === row.id && (
                  <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3" onClick={(e) => e.stopPropagation()}>
                    <span className="text-sm text-slate-700">Delete <strong>{row.name}</strong>?</span>
                    <button
                      type="button"
                      disabled={deleteBusy}
                      onClick={() => void onDeleteConfirm(row.id)}
                      className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleteBusy ? "Deleting..." : "Delete"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmId(null)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                )}
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
    </div>
  );
}
