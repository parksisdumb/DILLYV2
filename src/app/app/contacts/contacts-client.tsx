"use client";

import { useState, useMemo } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { AccountOption, PropertyOption } from "./page";

type ContactRow = {
  id: string;
  full_name: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  decision_role: string | null;
  account_id: string;
  account_name: string | null;
  last_touch_at: string | null;
  updated_at: string;
};

const ROLE_LABELS: Record<string, string> = {
  decision_maker: "Decision Maker",
  influencer: "Influencer",
  champion: "Champion",
  gatekeeper: "Gatekeeper",
  end_user: "End User",
  other: "Other",
};

const ROLE_COLORS: Record<string, string> = {
  decision_maker: "bg-blue-100 text-blue-700",
  influencer: "bg-purple-100 text-purple-700",
  champion: "bg-green-100 text-green-700",
  gatekeeper: "bg-slate-100 text-slate-600",
  end_user: "bg-gray-100 text-gray-600",
  other: "bg-gray-100 text-gray-600",
};

const ROLE_OPTIONS = [
  { value: "decision_maker", label: "Decision Maker" },
  { value: "influencer", label: "Influencer" },
  { value: "champion", label: "Champion" },
  { value: "gatekeeper", label: "Gatekeeper" },
  { value: "end_user", label: "End User" },
  { value: "other", label: "Other" },
];

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function RoleBadge({ role }: { role: string | null }) {
  if (!role) return null;
  const label = ROLE_LABELS[role] ?? role;
  const color = ROLE_COLORS[role] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}

export default function ContactsClient({
  contacts: initialContacts,
  accounts,
  properties,
  userId,
  userRole,
}: {
  contacts: ContactRow[];
  accounts: AccountOption[];
  properties: PropertyOption[];
  userId: string;
  userRole: string;
}) {
  const supabase = createBrowserSupabase();

  const [contacts, setContacts] = useState(initialContacts);
  const [search, setSearch] = useState("");
  const [filterAccountId, setFilterAccountId] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [sort, setSort] = useState<"name" | "last_touch" | "newest">("name");
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [newAccountId, setNewAccountId] = useState("");
  const [title, setTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [decisionRole, setDecisionRole] = useState("");
  const [newPropertyId, setNewPropertyId] = useState("");
  const [isPrimaryAccountContact, setIsPrimaryAccountContact] = useState(false);
  const [isPrimaryPropertyContact, setIsPrimaryPropertyContact] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  function showToast(tone: "success" | "error", text: string) {
    setToast({ tone, text });
    setTimeout(() => setToast(null), 3000);
  }

  const filtered = useMemo(() => {
    let list = contacts.filter((c) => {
      if (search && !c.full_name?.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterAccountId && c.account_id !== filterAccountId) return false;
      if (filterRole && c.decision_role !== filterRole) return false;
      return true;
    });

    list = [...list].sort((a, b) => {
      if (sort === "name") return (a.full_name ?? "").localeCompare(b.full_name ?? "");
      if (sort === "last_touch") {
        if (!a.last_touch_at && !b.last_touch_at) return 0;
        if (!a.last_touch_at) return 1;
        if (!b.last_touch_at) return -1;
        return b.last_touch_at.localeCompare(a.last_touch_at);
      }
      return b.updated_at.localeCompare(a.updated_at);
    });

    return list;
  }, [contacts, search, filterAccountId, filterRole, sort]);

  // Properties filtered by selected account (show all if no account yet)
  const filteredProperties = useMemo(() => {
    if (!newAccountId) return [];
    return properties.filter(
      (p) => p.primary_account_id === newAccountId || !p.primary_account_id,
    );
  }, [properties, newAccountId]);

  function resetCreateForm() {
    setFirstName("");
    setLastName("");
    setNewAccountId("");
    setTitle("");
    setPhone("");
    setEmail("");
    setDecisionRole("");
    setNewPropertyId("");
    setIsPrimaryAccountContact(false);
    setIsPrimaryPropertyContact(false);
    setError(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !newAccountId) {
      setError("First name, last name, and account are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("rpc_create_contact", {
        p_account_id: newAccountId,
        p_first_name: firstName.trim(),
        p_last_name: lastName.trim(),
        p_title: title.trim() || null,
        p_email: email.trim() || null,
        p_phone: phone.trim() || null,
        p_decision_role: decisionRole || null,
      });
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      // rpc_create_contact returns a TABLE (array of rows)
      const rows = data as unknown as Array<{
        id: string; full_name: string; account_id: string; title: string | null;
        phone: string | null; email: string | null; decision_role: string | null;
        updated_at: string;
      }>;
      const row = rows?.[0];
      if (!row) {
        setError("Contact creation failed.");
        return;
      }
      // Fire off property link + primary updates
      if (newPropertyId) {
        await supabase.rpc("rpc_upsert_property_contact", {
          p_property_id: newPropertyId,
          p_contact_id: row.id,
          p_role_category: "other",
          p_is_primary: isPrimaryPropertyContact,
        });
        if (isPrimaryPropertyContact) {
          await supabase
            .from("properties")
            .update({ primary_contact_id: row.id })
            .eq("id", newPropertyId);
        }
      }

      if (isPrimaryAccountContact) {
        await supabase
          .from("accounts")
          .update({ primary_contact_id: row.id })
          .eq("id", newAccountId);
      }

      const accountName = accounts.find((a) => a.id === newAccountId)?.name ?? null;
      const newContact: ContactRow = {
        id: row.id,
        full_name: row.full_name,
        title: row.title,
        phone: row.phone,
        email: row.email,
        decision_role: row.decision_role,
        account_id: newAccountId,
        account_name: accountName,
        last_touch_at: null,
        updated_at: row.updated_at ?? new Date().toISOString(),
      };
      setContacts((prev) => [newContact, ...prev]);
      resetCreateForm();
      setShowCreate(false);
      showToast("success", `${row.full_name} created.`);
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
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Contacts</h1>
        <button
          onClick={() => {
            setShowCreate((v) => !v);
            if (!showCreate) resetCreateForm();
          }}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {showCreate ? "Cancel" : "+ New Contact"}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">New Contact</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">First name *</label>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Last name *</label>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Account *</label>
              <select
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                value={newAccountId}
                onChange={(e) => setNewAccountId(e.target.value)}
              >
                <option value="">Select account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name ?? "—"}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Title</label>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Project Manager"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Decision Role</label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={decisionRole}
                  onChange={(e) => setDecisionRole(e.target.value)}
                >
                  <option value="">Select…</option>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
                <input
                  type="email"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="john@acme.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Phone</label>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="555-1234"
                />
              </div>
            </div>
            {newAccountId && filteredProperties.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Link Property</label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={newPropertyId}
                  onChange={(e) => {
                    setNewPropertyId(e.target.value);
                    if (!e.target.value) setIsPrimaryPropertyContact(false);
                  }}
                >
                  <option value="">None</option>
                  {filteredProperties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.address_line1}{p.city ? `, ${p.city}` : ""}{p.state ? ` ${p.state}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={isPrimaryAccountContact}
                  onChange={(e) => setIsPrimaryAccountContact(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                Primary account contact
              </label>
              {newPropertyId && (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={isPrimaryPropertyContact}
                    onChange={(e) => setIsPrimaryPropertyContact(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Primary property contact
                </label>
              )}
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create Contact"}
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
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Search by name…"
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
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          >
            <option value="name">Sort: Name</option>
            <option value="last_touch">Sort: Last Touched</option>
            <option value="newest">Sort: Newest</option>
          </select>
        </div>
        {/* Role chips */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[{ value: "", label: "All" }, ...ROLE_OPTIONS].map((r) => (
            <button
              key={r.value}
              onClick={() => setFilterRole(r.value)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filterRole === r.value
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      <p className="text-xs text-slate-500">
        {filtered.length} contact{filtered.length !== 1 ? "s" : ""}
      </p>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No contacts match your filters.
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Account</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Last Touched</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => {
                      window.location.href = `/app/contacts/${c.id}`;
                    }}
                    className="cursor-pointer border-b border-slate-100 text-slate-700 last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <div className="flex items-center gap-2">
                        {c.full_name ?? "—"}
                        {c.decision_role && <RoleBadge role={c.decision_role} />}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.title ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{c.account_name ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{c.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(c.last_touch_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {filtered.map((c) => (
              <div
                key={c.id}
                onClick={() => {
                  window.location.href = `/app/contacts/${c.id}`;
                }}
                className="cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 hover:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900">{c.full_name ?? "—"}</span>
                  {c.decision_role && <RoleBadge role={c.decision_role} />}
                </div>
                {c.account_name && (
                  <p className="mt-0.5 text-xs text-slate-500">{c.account_name}</p>
                )}
                {c.title && <p className="text-xs text-slate-500">{c.title}</p>}
                {(c.phone || c.email) && (
                  <p className="mt-1 text-xs text-slate-600">
                    {[c.phone, c.email].filter(Boolean).join(" · ")}
                  </p>
                )}
                <p className="mt-1 text-xs text-slate-400">
                  Last touch: {formatDate(c.last_touch_at)}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
