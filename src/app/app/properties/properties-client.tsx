"use client";

import { useMemo, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { AccountOption, ContactOption } from "./page";

type PropertyRow = {
  id: string;
  name: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  primary_account_id: string | null;
  primary_account_name: string | null;
  primary_contact_id: string | null;
  primary_contact_name: string | null;
  open_opportunity_count: number;
  roof_type: string | null;
  roof_age_years: number | null;
  sq_footage: number | null;
  website: string | null;
  notes: string | null;
  updated_at: string;
};

const ROOF_TYPE_OPTIONS = [
  { value: "flat", label: "Flat" },
  { value: "tpo", label: "TPO" },
  { value: "epdm", label: "EPDM" },
  { value: "metal", label: "Metal" },
  { value: "built_up", label: "Built-Up" },
  { value: "3_tab", label: "3-Tab Shingle" },
  { value: "architectural", label: "Architectural Shingle" },
  { value: "other", label: "Other" },
];

function formatAddress(p: PropertyRow) {
  return `${p.address_line1}, ${p.city} ${p.state}`;
}

export default function PropertiesClient({
  properties: initialProperties,
  accounts,
  contacts,
  orgId,
  userId,
  userRole,
}: {
  properties: PropertyRow[];
  accounts: AccountOption[];
  contacts: ContactOption[];
  orgId: string;
  userId: string;
  userRole: string;
}) {
  const supabase = createBrowserSupabase();

  const [properties, setProperties] = useState(initialProperties);
  const [search, setSearch] = useState("");
  const [filterAccountId, setFilterAccountId] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [filterState, setFilterState] = useState("");
  const [sort, setSort] = useState<"updated" | "name" | "address" | "opportunities">("updated");
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [propName, setPropName] = useState("");
  const [addr1, setAddr1] = useState("");
  const [addr2, setAddr2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postal, setPostal] = useState("");
  const [accountId, setAccountId] = useState("");
  const [contactId, setContactId] = useState("");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState("");
  const [roofType, setRoofType] = useState("");
  const [roofAgeYears, setRoofAgeYears] = useState("");
  const [sqFootage, setSqFootage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  function showToast(tone: "success" | "error", text: string) {
    setToast({ tone, text });
    setTimeout(() => setToast(null), 3000);
  }

  // Distinct city/state values for filters
  const distinctCities = useMemo(
    () => [...new Set(properties.map((p) => p.city))].sort(),
    [properties],
  );
  const distinctStates = useMemo(
    () => [...new Set(properties.map((p) => p.state))].sort(),
    [properties],
  );

  const filtered = useMemo(() => {
    let list = properties.filter((p) => {
      if (search) {
        const q = search.toLowerCase();
        const matchesName = p.name?.toLowerCase().includes(q);
        const matchesAddr = p.address_line1.toLowerCase().includes(q);
        const matchesCity = p.city.toLowerCase().includes(q);
        const matchesAccount = p.primary_account_name?.toLowerCase().includes(q);
        if (!matchesName && !matchesAddr && !matchesCity && !matchesAccount) return false;
      }
      if (filterAccountId && p.primary_account_id !== filterAccountId) return false;
      if (filterCity && p.city !== filterCity) return false;
      if (filterState && p.state !== filterState) return false;
      return true;
    });

    list = [...list].sort((a, b) => {
      if (sort === "name") return (a.name ?? a.address_line1).localeCompare(b.name ?? b.address_line1);
      if (sort === "address") return a.address_line1.localeCompare(b.address_line1);
      if (sort === "opportunities") return b.open_opportunity_count - a.open_opportunity_count;
      return b.updated_at.localeCompare(a.updated_at);
    });

    return list;
  }, [properties, search, filterAccountId, filterCity, filterState, sort]);

  function resetCreateForm() {
    setPropName("");
    setAddr1("");
    setAddr2("");
    setCity("");
    setState("");
    setPostal("");
    setAccountId("");
    setContactId("");
    setNotes("");
    setWebsite("");
    setRoofType("");
    setRoofAgeYears("");
    setSqFootage("");
    setError(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!addr1.trim() || !city.trim() || !state.trim() || !postal.trim() || !accountId) {
      setError("Address, city, state, postal code, and account are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data, error: insError } = await supabase
        .from("properties")
        .insert({
          org_id: orgId,
          created_by: userId,
          name: propName.trim() || null,
          address_line1: addr1.trim(),
          address_line2: addr2.trim() || null,
          city: city.trim(),
          state: state.trim().toUpperCase(),
          postal_code: postal.trim(),
          primary_account_id: accountId || null,
          primary_contact_id: contactId || null,
          notes: notes.trim() || null,
          website: website.trim() || null,
          roof_type: roofType || null,
          roof_age_years: roofAgeYears ? parseInt(roofAgeYears, 10) : null,
          sq_footage: sqFootage ? parseInt(sqFootage, 10) : null,
        })
        .select("id")
        .single();

      if (insError) {
        setError(insError.message);
        return;
      }

      const accountName = accounts.find((a) => a.id === accountId)?.name ?? null;
      const contactName = contactId
        ? (contacts.find((c) => c.id === contactId)?.full_name ?? null)
        : null;

      const newProp: PropertyRow = {
        id: (data as { id: string }).id,
        name: propName.trim() || null,
        address_line1: addr1.trim(),
        address_line2: addr2.trim() || null,
        city: city.trim(),
        state: state.trim().toUpperCase(),
        postal_code: postal.trim(),
        primary_account_id: accountId || null,
        primary_account_name: accountName,
        primary_contact_id: contactId || null,
        primary_contact_name: contactName,
        open_opportunity_count: 0,
        roof_type: roofType || null,
        roof_age_years: roofAgeYears ? parseInt(roofAgeYears, 10) : null,
        sq_footage: sqFootage ? parseInt(sqFootage, 10) : null,
        website: website.trim() || null,
        notes: notes.trim() || null,
        updated_at: new Date().toISOString(),
      };

      setProperties((prev) => [newProp, ...prev]);
      resetCreateForm();
      setShowCreate(false);
      showToast("success", `${addr1.trim()} created.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-2xl px-4 py-3 text-sm font-medium shadow-lg ${
            toast.tone === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Properties</h1>
        <button
          onClick={() => {
            setShowCreate((v) => !v);
            if (!showCreate) resetCreateForm();
          }}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {showCreate ? "Cancel" : "+ New Property"}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">New Property</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Property Name <span className="font-normal text-slate-400">(recommended)</span>
              </label>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                value={propName}
                onChange={(e) => setPropName(e.target.value)}
                placeholder="e.g. Lakewood Office Park, Riverstone Plaza"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Address Line 1 *
              </label>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                value={addr1}
                onChange={(e) => setAddr1(e.target.value)}
                placeholder="123 Main St"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Address Line 2
              </label>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                value={addr2}
                onChange={(e) => setAddr2(e.target.value)}
                placeholder="Suite 100"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">City *</label>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Austin"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">State *</label>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm uppercase focus:border-blue-400 focus:outline-none"
                  value={state}
                  onChange={(e) => setState(e.target.value.toUpperCase())}
                  placeholder="TX"
                  maxLength={2}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Postal Code *
                </label>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={postal}
                  onChange={(e) => setPostal(e.target.value)}
                  placeholder="78701"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Account *</label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="">Select account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name ?? "—"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Primary Contact
                </label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={contactId}
                  onChange={(e) => setContactId(e.target.value)}
                >
                  <option value="">None</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name ?? "—"}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Website</label>
              <input
                type="url"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://example.com"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Roof Type</label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={roofType}
                  onChange={(e) => setRoofType(e.target.value)}
                >
                  <option value="">Unknown</option>
                  {ROOF_TYPE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Age (yrs)</label>
                <input
                  type="number"
                  min="0"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={roofAgeYears}
                  onChange={(e) => setRoofAgeYears(e.target.value)}
                  placeholder="10"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Sq Footage</label>
                <input
                  type="number"
                  min="0"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={sqFootage}
                  onChange={(e) => setSqFootage(e.target.value)}
                  placeholder="25000"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Notes</label>
              <textarea
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any notes about the property…"
              />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create Property"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  resetCreateForm();
                }}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search name, address, city, or account…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[180px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
        />
        <select
          value={filterAccountId}
          onChange={(e) => setFilterAccountId(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name ?? "—"}
            </option>
          ))}
        </select>
        {distinctCities.length > 0 && (
          <select
            value={filterCity}
            onChange={(e) => setFilterCity(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          >
            <option value="">All cities</option>
            {distinctCities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        {distinctStates.length > 0 && (
          <select
            value={filterState}
            onChange={(e) => setFilterState(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          >
            <option value="">All states</option>
            {distinctStates.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
        >
          <option value="updated">Sort: Recently Updated</option>
          <option value="name">Sort: Name</option>
          <option value="address">Sort: Address</option>
          <option value="opportunities">Sort: Most Opportunities</option>
        </select>
      </div>

      {/* Results count */}
      <p className="text-xs text-slate-500">
        {filtered.length} propert{filtered.length !== 1 ? "ies" : "y"}
      </p>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No properties match your filters.
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
                  <th className="px-4 py-3 font-medium">Roof</th>
                  <th className="px-4 py-3 font-medium">Opps</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => {
                      window.location.href = `/app/properties/${p.id}`;
                    }}
                    className="cursor-pointer border-b border-slate-100 text-slate-700 last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-4 py-3">
                      {p.name ? (
                        <>
                          <p className="font-medium text-slate-900">{p.name}</p>
                          <p className="text-xs text-slate-500">{p.address_line1}</p>
                        </>
                      ) : (
                        <p className="font-medium text-slate-900">{p.address_line1}</p>
                      )}
                      <p className="text-xs text-slate-500">
                        {p.city}, {p.state} {p.postal_code}
                      </p>
                      {p.website && (
                        <p className="mt-0.5 truncate text-xs text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>
                          <a href={p.website} target="_blank" rel="noopener noreferrer">{p.website.replace(/^https?:\/\//, "")}</a>
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{p.primary_account_name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {p.roof_type && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                            {p.roof_type.toUpperCase()}
                          </span>
                        )}
                        {p.roof_age_years != null && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                            {p.roof_age_years}yr
                          </span>
                        )}
                        {p.sq_footage != null && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                            {p.sq_footage >= 1000 ? `${Math.round(p.sq_footage / 1000)}K` : p.sq_footage} sqft
                          </span>
                        )}
                        {!p.roof_type && p.roof_age_years == null && p.sq_footage == null && (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {p.open_opportunity_count > 0 ? (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                          {p.open_opportunity_count}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {filtered.map((p) => (
              <div
                key={p.id}
                onClick={() => {
                  window.location.href = `/app/properties/${p.id}`;
                }}
                className="cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {p.name ? (
                      <>
                        <p className="font-semibold text-slate-900">{p.name}</p>
                        <p className="text-xs text-slate-500">{p.address_line1}</p>
                      </>
                    ) : (
                      <p className="font-semibold text-slate-900">{p.address_line1}</p>
                    )}
                    <p className="text-xs text-slate-500">
                      {p.city}, {p.state} {p.postal_code}
                    </p>
                  </div>
                  {p.open_opportunity_count > 0 && (
                    <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {p.open_opportunity_count} opp{p.open_opportunity_count !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                {p.primary_account_name && (
                  <p className="mt-1 text-xs text-slate-500">{p.primary_account_name}</p>
                )}
                {p.website && (
                  <p className="mt-1 truncate text-xs text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>
                    <a href={p.website} target="_blank" rel="noopener noreferrer">{p.website.replace(/^https?:\/\//, "")}</a>
                  </p>
                )}
                {(p.roof_type || p.roof_age_years != null || p.sq_footage != null) && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.roof_type && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        {p.roof_type.toUpperCase()}
                      </span>
                    )}
                    {p.roof_age_years != null && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        {p.roof_age_years}yr
                      </span>
                    )}
                    {p.sq_footage != null && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        {p.sq_footage >= 1000 ? `${Math.round(p.sq_footage / 1000)}K` : p.sq_footage} sqft
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
