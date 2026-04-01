"use client";

import { useMemo, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { formatPhone } from "@/lib/utils/format";

// ── Types ──────────────────────────────────────────────────────────────────

type Account = {
  id: string;
  name: string | null;
  account_type: string | null;
  status: string;
  notes: string | null;
  website: string | null;
  phone: string | null;
  created_by: string | null;
  updated_at: string;
};

type Contact = {
  id: string;
  full_name: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  decision_role: string | null;
  updated_at: string;
};

type Property = {
  id: string;
  address_line1: string;
  city: string | null;
  state: string | null;
  postal_code: string | null;
};

type Opportunity = {
  id: string;
  title: string | null;
  status: string;
  estimated_value: number | null;
  opened_at: string;
  closed_at: string | null;
  property_id: string;
};

type Touchpoint = {
  id: string;
  happened_at: string;
  notes: string | null;
  engagement_phase: string;
  touchpoint_type_id: string;
  outcome_id: string | null;
  contact_id: string | null;
};

type TouchpointType = {
  id: string;
  name: string;
  key?: string | null;
  is_outreach: boolean;
};

type Outcome = {
  id: string;
  name: string;
  touchpoint_type_id?: string | null;
};

type AvailableProperty = {
  id: string;
  address_line1: string;
  city: string | null;
  state: string | null;
  postal_code: string | null;
};

type AvailableContact = {
  id: string;
  full_name: string | null;
  title: string | null;
};

type Props = {
  account: Account;
  contacts: Contact[];
  properties: Property[];
  opportunities: Opportunity[];
  touchpoints: Touchpoint[];
  touchpointTypes: TouchpointType[];
  touchpointOutcomes: Outcome[];
  userId: string;
  orgId: string;
  userRole: string;
  availableProperties: AvailableProperty[];
  availableContacts: AvailableContact[];
};

type Tab = "contacts" | "properties" | "opportunities" | "timeline";

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

const PHASE_LABELS: Record<string, string> = {
  first_touch: "First Touch",
  follow_up: "Follow Up",
  visibility: "Visibility",
};

const PHASE_COLORS: Record<string, string> = {
  first_touch: "bg-blue-100 text-blue-700",
  follow_up: "bg-amber-100 text-amber-700",
  visibility: "bg-slate-100 text-slate-600",
};

const OPP_STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-100 text-blue-700",
  won: "bg-green-100 text-green-700",
  lost: "bg-slate-100 text-slate-500",
};

// ── Helpers ────────────────────────────────────────────────────────────────

const input =
  "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none";

const sectionLabel = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500";

const chipBtn = (active: boolean) =>
  [
    "rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
    active
      ? "border-blue-600 bg-blue-600 text-white"
      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
  ].join(" ");

const tabBtn = (active: boolean) =>
  [
    "px-3 py-2 text-sm font-medium transition-colors border-b-2",
    active
      ? "border-blue-600 text-blue-600"
      : "border-transparent text-slate-500 hover:text-slate-700",
  ].join(" ");

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatCurrency(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function propertyLabel(p: { address_line1: string; city: string | null; state: string | null }): string {
  return [p.address_line1, p.city, p.state].filter(Boolean).join(", ");
}

// ── Component ──────────────────────────────────────────────────────────────

export default function AccountDetailClient({
  account,
  contacts: initialContacts,
  properties: initialProperties,
  opportunities: initialOpportunities,
  touchpoints: initialTouchpoints,
  touchpointTypes,
  touchpointOutcomes,
  userId,
  orgId,
  userRole,
  availableProperties,
  availableContacts,
}: Props) {
  const supabase = useMemo(() => createBrowserSupabase(), []);

  // ── Data state ──
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [properties, setProperties] = useState<Property[]>(initialProperties);
  const [opportunities] = useState<Opportunity[]>(initialOpportunities);
  const [touchpoints, setTouchpoints] = useState<Touchpoint[]>(initialTouchpoints);

  // ── Tab state ──
  const [tab, setTab] = useState<Tab>("contacts");

  // ── Log Touchpoint form ──
  const [showLogForm, setShowLogForm] = useState(false);
  const [logContactId, setLogContactId] = useState("");
  const [logTypeId, setLogTypeId] = useState("");
  const [logOutcomeId, setLogOutcomeId] = useState("");
  const [logNotes, setLogNotes] = useState("");
  const [logBusy, setLogBusy] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  // ── Add Contact form ──
  const [showAddContact, setShowAddContact] = useState(false);
  const [cFirst, setCFirst] = useState("");
  const [cLast, setCLast] = useState("");
  const [cTitle, setCTitle] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cRole, setCRole] = useState("");
  const [cBusy, setCBusy] = useState(false);
  const [cError, setCError] = useState<string | null>(null);

  // ── Add Property form ──
  const [showAddProperty, setShowAddProperty] = useState(false);
  const [pAddr, setPAddr] = useState("");
  const [pCity, setPCity] = useState("");
  const [pState, setPState] = useState("");
  const [pPostal, setPPostal] = useState("");
  const [pBusy, setPBusy] = useState(false);
  const [pError, setPError] = useState<string | null>(null);

  // ── Link Existing Property form ──
  const [showLinkProperty, setShowLinkProperty] = useState(false);
  const [linkPropId, setLinkPropId] = useState("");
  const [linkPropBusy, setLinkPropBusy] = useState(false);
  const [linkPropError, setLinkPropError] = useState<string | null>(null);
  const [localAvailableProps, setLocalAvailableProps] = useState(availableProperties);

  // ── Link Existing Contact form ──
  const [showLinkContact, setShowLinkContact] = useState(false);
  const [linkContactId, setLinkContactId] = useState("");
  const [linkContactBusy, setLinkContactBusy] = useState(false);
  const [linkContactError, setLinkContactError] = useState<string | null>(null);
  const [localAvailableContacts, setLocalAvailableContacts] = useState(availableContacts);

  // ── Toast ──
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  function showToast(tone: "success" | "error", text: string) {
    setToast({ tone, text });
    setTimeout(() => setToast((prev) => (prev?.text === text ? null : prev)), 2500);
  }

  // ── Derived lookups ──
  const outreachTypes = useMemo(() => touchpointTypes.filter((t) => t.is_outreach), [touchpointTypes]);
  const typesById = useMemo(() => new Map(touchpointTypes.map((t) => [t.id, t])), [touchpointTypes]);
  const outcomesById = useMemo(() => new Map(touchpointOutcomes.map((o) => [o.id, o])), [touchpointOutcomes]);
  const contactsById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const propertiesById = useMemo(() => new Map(properties.map((p) => [p.id, p])), [properties]);

  const lastTouchPerContact = useMemo(() => {
    const map = new Map<string, string>();
    for (const tp of touchpoints) {
      if (!tp.contact_id) continue;
      const existing = map.get(tp.contact_id);
      if (!existing || tp.happened_at > existing) map.set(tp.contact_id, tp.happened_at);
    }
    return map;
  }, [touchpoints]);

  const logFilteredOutcomes = useMemo(() => {
    if (!logTypeId) return [];
    const typeSpecific = touchpointOutcomes.filter((o) => o.touchpoint_type_id === logTypeId);
    return typeSpecific.length > 0 ? typeSpecific : touchpointOutcomes;
  }, [touchpointOutcomes, logTypeId]);

  const lastTouchAt = touchpoints[0]?.happened_at ?? null;

  // ── Log Touchpoint submit ──
  async function onLogSubmit() {
    if (!logContactId) { setLogError("Select a contact."); return; }
    if (!logTypeId) { setLogError("Select how you reached out."); return; }
    if (!logNotes.trim()) { setLogError("Notes are required."); return; }

    // Verify contact belongs to this account
    const contact = contactsById.get(logContactId);
    if (!contact) { setLogError("Contact not found."); return; }

    setLogError(null);
    setLogBusy(true);

    const { data: rpcData, error: rpcErr } = await supabase.rpc("rpc_log_outreach_touchpoint", {
      p_contact_id: logContactId,
      p_account_id: account.id,
      p_touchpoint_type_id: logTypeId,
      p_outcome_id: logOutcomeId || null,
      p_notes: logNotes.trim(),
      p_engagement_phase: "follow_up",
    });

    setLogBusy(false);

    if (rpcErr) { setLogError(rpcErr.message); return; }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    const newTp: Touchpoint = {
      id: (row as Record<string, unknown>)?.touchpoint_id as string ?? crypto.randomUUID(),
      happened_at: new Date().toISOString(),
      notes: logNotes.trim(),
      engagement_phase: "follow_up",
      touchpoint_type_id: logTypeId,
      outcome_id: logOutcomeId || null,
      contact_id: logContactId,
    };

    setTouchpoints((prev) => [newTp, ...prev]);
    setShowLogForm(false);
    setLogContactId(""); setLogTypeId(""); setLogOutcomeId(""); setLogNotes("");
    setTab("timeline");
    showToast("success", "Touchpoint logged.");
  }

  // ── Add Contact submit ──
  async function onAddContact() {
    if (!cFirst.trim() || !cLast.trim()) { setCError("First and last name are required."); return; }
    setCError(null);
    setCBusy(true);

    const { data, error } = await supabase.rpc("rpc_create_contact", {
      p_account_id: account.id,
      p_first_name: cFirst.trim(),
      p_last_name: cLast.trim(),
      p_title: cTitle.trim() || null,
      p_email: cEmail.trim() || null,
      p_phone: cPhone.trim() || null,
      p_decision_role: cRole.trim() || null,
      p_priority_score: 0,
    });

    setCBusy(false);

    if (error) { setCError(error.message); return; }

    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
    const newContact: Contact = {
      id: row?.id as string,
      full_name: `${cFirst.trim()} ${cLast.trim()}`,
      title: cTitle.trim() || null,
      phone: cPhone.trim() || null,
      email: cEmail.trim() || null,
      decision_role: cRole.trim() || null,
      updated_at: new Date().toISOString(),
    };

    setContacts((prev) => [...prev, newContact].sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "")));
    setShowAddContact(false);
    setCFirst(""); setCLast(""); setCTitle(""); setCEmail(""); setCPhone(""); setCRole("");
    setTab("contacts");
    showToast("success", `${newContact.full_name} added.`);
  }

  // ── Add Property submit ──
  async function onAddProperty() {
    if (!pAddr.trim()) { setPError("Address is required."); return; }
    setPError(null);
    setPBusy(true);

    const { data, error } = await supabase.rpc("rpc_quick_add_property", {
      p_account_id: account.id,
      p_address_line1: pAddr.trim(),
      p_city: pCity.trim() || null,
      p_state: pState.trim() || null,
      p_postal_code: pPostal.trim() || null,
    });

    setPBusy(false);

    if (error) { setPError(error.message); return; }

    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
    const newProp: Property = {
      id: row?.id as string,
      address_line1: pAddr.trim(),
      city: pCity.trim() || null,
      state: pState.trim() || null,
      postal_code: pPostal.trim() || null,
    };

    setProperties((prev) => [...prev, newProp].sort((a, b) => a.address_line1.localeCompare(b.address_line1)));
    setShowAddProperty(false);
    setPAddr(""); setPCity(""); setPState(""); setPPostal("");
    setTab("properties");
    showToast("success", "Property added.");
  }

  // ── Link Existing Property submit ──
  async function onLinkProperty() {
    if (!linkPropId) { setLinkPropError("Select a property."); return; }
    setLinkPropError(null);
    setLinkPropBusy(true);

    const { error } = await supabase
      .from("properties")
      .update({ primary_account_id: account.id })
      .eq("id", linkPropId);

    setLinkPropBusy(false);

    if (error) { setLinkPropError(error.message); return; }

    const linked = localAvailableProps.find((p) => p.id === linkPropId);
    if (linked) {
      setProperties((prev) => [...prev, { id: linked.id, address_line1: linked.address_line1, city: linked.city, state: linked.state, postal_code: linked.postal_code }].sort((a, b) => a.address_line1.localeCompare(b.address_line1)));
      setLocalAvailableProps((prev) => prev.filter((p) => p.id !== linkPropId));
    }
    setShowLinkProperty(false);
    setLinkPropId("");
    setTab("properties");
    showToast("success", "Property linked.");
  }

  // ── Link Existing Contact submit ──
  async function onLinkContact() {
    if (!linkContactId) { setLinkContactError("Select a contact."); return; }
    setLinkContactError(null);
    setLinkContactBusy(true);

    const { error } = await supabase
      .from("contacts")
      .update({ account_id: account.id })
      .eq("id", linkContactId);

    setLinkContactBusy(false);

    if (error) { setLinkContactError(error.message); return; }

    const linked = localAvailableContacts.find((c) => c.id === linkContactId);
    if (linked) {
      setContacts((prev) => [...prev, { id: linked.id, full_name: linked.full_name, title: linked.title, phone: null, email: null, decision_role: null, updated_at: new Date().toISOString() }].sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "")));
      setLocalAvailableContacts((prev) => prev.filter((c) => c.id !== linkContactId));
    }
    setShowLinkContact(false);
    setLinkContactId("");
    setTab("contacts");
    showToast("success", "Contact linked.");
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* Back navigation */}
      <a
        href="/app/accounts"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Accounts
      </a>

      {/* ── Header card ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h1 className="text-xl font-semibold text-slate-900">{account.name ?? "Unnamed Account"}</h1>
            {account.account_type && (
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TYPE_COLORS[account.account_type] ?? "bg-slate-100 text-slate-600"}`}>
                {TYPE_LABELS[account.account_type] ?? account.account_type}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
            <span className={`font-medium ${account.status === "active" ? "text-emerald-600" : "text-slate-400"}`}>
              ● {account.status === "active" ? "Active" : account.status}
            </span>
            {account.website && (
              <a href={account.website.startsWith("http") ? account.website : `https://${account.website}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 hover:underline">
                {account.website.replace(/^https?:\/\//, "")}
              </a>
            )}
            {account.phone && (
              <a href={`tel:${account.phone}`} className="text-blue-600 font-medium hover:underline">
                {formatPhone(account.phone)}
              </a>
            )}
            {lastTouchAt && <span>Last touch: {formatDate(lastTouchAt)}</span>}
          </div>

          {account.notes && (
            <p className="text-sm text-slate-600">{account.notes}</p>
          )}
        </div>

        {/* ICP Fit placeholder */}
        <div className="border-t border-slate-100 px-4 py-2.5 flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">ICP Fit</span>
          <div className="flex gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-2 w-5 rounded-sm bg-slate-100" />
            ))}
          </div>
          <span className="text-xs text-slate-400">Scoring · Coming in Phase 2</span>
        </div>
      </div>

      {/* ── Action buttons ── */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => { setShowLogForm(!showLogForm); setShowAddContact(false); setShowAddProperty(false); setShowLinkProperty(false); setShowLinkContact(false); setLogError(null); }}
          className={`rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${showLogForm ? "bg-blue-700 text-white" : "bg-blue-600 text-white hover:bg-blue-700"}`}
        >
          Log Touchpoint
        </button>
        <button
          type="button"
          onClick={() => { setShowAddContact(!showAddContact); setShowLogForm(false); setShowAddProperty(false); setShowLinkProperty(false); setShowLinkContact(false); setCError(null); }}
          className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${showAddContact ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
        >
          + Contact
        </button>
        <button
          type="button"
          onClick={() => { setShowAddProperty(!showAddProperty); setShowLogForm(false); setShowAddContact(false); setShowLinkProperty(false); setShowLinkContact(false); setPError(null); }}
          className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${showAddProperty ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
        >
          + Property
        </button>
        {localAvailableContacts.length > 0 && (
          <button
            type="button"
            onClick={() => { setShowLinkContact(!showLinkContact); setShowLogForm(false); setShowAddContact(false); setShowAddProperty(false); setShowLinkProperty(false); setLinkContactError(null); }}
            className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${showLinkContact ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            Link Contact
          </button>
        )}
        {localAvailableProps.length > 0 && (
          <button
            type="button"
            onClick={() => { setShowLinkProperty(!showLinkProperty); setShowLogForm(false); setShowAddContact(false); setShowAddProperty(false); setShowLinkContact(false); setLinkPropError(null); }}
            className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${showLinkProperty ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            Link Property
          </button>
        )}
      </div>

      {/* ── Log Touchpoint form ── */}
      {showLogForm && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Log Touchpoint</div>

          {logError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{logError}</div>
          )}

          {contacts.length === 0 ? (
            <p className="text-sm text-slate-500">Add a contact first before logging a touchpoint.</p>
          ) : (
            <>
              <div>
                <label className={sectionLabel}>Contact</label>
                <select
                  className={input}
                  value={logContactId}
                  onChange={(e) => { setLogContactId(e.target.value); setLogError(null); }}
                >
                  <option value="">Select contact...</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name ?? "Unnamed"}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={sectionLabel}>How did you reach out?</label>
                <div className="flex flex-wrap gap-2">
                  {outreachTypes.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => { setLogTypeId(t.id); setLogOutcomeId(""); setLogError(null); }}
                      className={chipBtn(logTypeId === t.id)}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>

              {logTypeId && logFilteredOutcomes.length > 0 && (
                <div>
                  <label className={sectionLabel}>Outcome</label>
                  <div className="flex flex-wrap gap-2">
                    {logFilteredOutcomes.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => setLogOutcomeId(logOutcomeId === o.id ? "" : o.id)}
                        className={chipBtn(logOutcomeId === o.id)}
                      >
                        {o.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className={sectionLabel}>Notes</label>
                <input
                  className={input}
                  placeholder="What happened? (required)"
                  value={logNotes}
                  onChange={(e) => { setLogNotes(e.target.value); setLogError(null); }}
                />
              </div>

              <button
                type="button"
                disabled={logBusy}
                onClick={() => void onLogSubmit()}
                className={[
                  "rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
                  logContactId && logTypeId && logNotes.trim()
                    ? "bg-blue-600 text-white hover:bg-blue-700"
                    : "bg-slate-100 text-slate-400",
                ].join(" ")}
              >
                {logBusy ? "Logging..." : "Log Touchpoint"}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Add Contact form ── */}
      {showAddContact && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Add Contact</div>

          {cError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{cError}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={sectionLabel}>First Name *</label>
              <input className={input} placeholder="John" value={cFirst} onChange={(e) => { setCFirst(e.target.value); setCError(null); }} />
            </div>
            <div>
              <label className={sectionLabel}>Last Name *</label>
              <input className={input} placeholder="Smith" value={cLast} onChange={(e) => { setCLast(e.target.value); setCError(null); }} />
            </div>
            <div>
              <label className={sectionLabel}>Title</label>
              <input className={input} placeholder="Property Manager" value={cTitle} onChange={(e) => setCTitle(e.target.value)} />
            </div>
            <div>
              <label className={sectionLabel}>Decision Role</label>
              <input className={input} placeholder="Decision Maker" value={cRole} onChange={(e) => setCRole(e.target.value)} />
            </div>
            <div>
              <label className={sectionLabel}>Email</label>
              <input className={input} type="email" placeholder="john@acme.com" value={cEmail} onChange={(e) => setCEmail(e.target.value)} />
            </div>
            <div>
              <label className={sectionLabel}>Phone</label>
              <input className={input} type="tel" placeholder="(555) 000-0000" value={cPhone} onChange={(e) => setCPhone(e.target.value)} />
            </div>
          </div>

          <button
            type="button"
            disabled={cBusy}
            onClick={() => void onAddContact()}
            className={[
              "rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
              cFirst.trim() && cLast.trim()
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-slate-100 text-slate-400",
            ].join(" ")}
          >
            {cBusy ? "Saving..." : "Add Contact"}
          </button>
        </div>
      )}

      {/* ── Add Property form ── */}
      {showAddProperty && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Add Property</div>

          {pError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{pError}</div>
          )}

          <div>
            <label className={sectionLabel}>Address *</label>
            <input className={input} placeholder="123 Main St" value={pAddr} onChange={(e) => { setPAddr(e.target.value); setPError(null); }} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className={sectionLabel}>City</label>
              <input className={input} placeholder="Austin" value={pCity} onChange={(e) => setPCity(e.target.value)} />
            </div>
            <div>
              <label className={sectionLabel}>State</label>
              <input className={input} placeholder="TX" value={pState} onChange={(e) => setPState(e.target.value)} />
            </div>
            <div>
              <label className={sectionLabel}>Zip</label>
              <input className={input} placeholder="78701" value={pPostal} onChange={(e) => setPPostal(e.target.value)} />
            </div>
          </div>

          <button
            type="button"
            disabled={pBusy}
            onClick={() => void onAddProperty()}
            className={[
              "rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
              pAddr.trim()
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-slate-100 text-slate-400",
            ].join(" ")}
          >
            {pBusy ? "Saving..." : "Add Property"}
          </button>
        </div>
      )}

      {/* ── Link Existing Contact form ── */}
      {showLinkContact && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Link Existing Contact</div>

          {linkContactError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{linkContactError}</div>
          )}

          <div>
            <label className={sectionLabel}>Contact</label>
            <select
              className={input}
              value={linkContactId}
              onChange={(e) => { setLinkContactId(e.target.value); setLinkContactError(null); }}
            >
              <option value="">Select contact...</option>
              {localAvailableContacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name ?? "Unnamed"}{c.title ? ` — ${c.title}` : ""}
                </option>
              ))}
            </select>
          </div>

          <p className="text-xs text-slate-500">This will reassign the contact to this account.</p>

          <button
            type="button"
            disabled={linkContactBusy}
            onClick={() => void onLinkContact()}
            className={[
              "rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
              linkContactId
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-slate-100 text-slate-400",
            ].join(" ")}
          >
            {linkContactBusy ? "Linking..." : "Link Contact"}
          </button>
        </div>
      )}

      {/* ── Link Existing Property form ── */}
      {showLinkProperty && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Link Existing Property</div>

          {linkPropError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{linkPropError}</div>
          )}

          <div>
            <label className={sectionLabel}>Property</label>
            <select
              className={input}
              value={linkPropId}
              onChange={(e) => { setLinkPropId(e.target.value); setLinkPropError(null); }}
            >
              <option value="">Select property...</option>
              {localAvailableProps.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.address_line1}{p.city ? `, ${p.city}` : ""}{p.state ? ` ${p.state}` : ""}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            disabled={linkPropBusy}
            onClick={() => void onLinkProperty()}
            className={[
              "rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
              linkPropId
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-slate-100 text-slate-400",
            ].join(" ")}
          >
            {linkPropBusy ? "Linking..." : "Link Property"}
          </button>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-slate-200 overflow-x-auto">
          {(["contacts", "properties", "opportunities", "timeline"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={tabBtn(tab === t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
              {t === "contacts" && contacts.length > 0 && (
                <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{contacts.length}</span>
              )}
              {t === "properties" && properties.length > 0 && (
                <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{properties.length}</span>
              )}
              {t === "opportunities" && opportunities.length > 0 && (
                <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{opportunities.length}</span>
              )}
              {t === "timeline" && touchpoints.length > 0 && (
                <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{touchpoints.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Contacts tab ── */}
        {tab === "contacts" && (
          <div>
            {contacts.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No contacts yet. Use <strong>+ Contact</strong> to add one.
              </div>
            ) : (
              <>
                {/* Desktop */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-4 py-3 font-medium">Name</th>
                        <th className="px-4 py-3 font-medium">Title</th>
                        <th className="px-4 py-3 font-medium">Phone</th>
                        <th className="px-4 py-3 font-medium">Email</th>
                        <th className="px-4 py-3 font-medium">Last Touch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.map((c) => (
                        <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer" onClick={() => window.location.href = `/app/contacts/${c.id}`}>
                          <td className="px-4 py-3 font-medium text-blue-600 hover:underline">{c.full_name ?? "—"}</td>
                          <td className="px-4 py-3 text-slate-600">{c.title ?? "—"}</td>
                          <td className="px-4 py-3 text-slate-600">
                            {c.phone ? (
                              <a href={`tel:${c.phone}`} className="text-blue-600 font-medium hover:underline">
                                {formatPhone(c.phone)}
                              </a>
                            ) : "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-500">{c.email ?? "—"}</td>
                          <td className="px-4 py-3 text-slate-500">{formatDate(lastTouchPerContact.get(c.id) ?? null)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Mobile */}
                <div className="md:hidden divide-y divide-slate-100">
                  {contacts.map((c) => (
                    <a key={c.id} href={`/app/contacts/${c.id}`} className="block px-4 py-3.5 space-y-0.5 hover:bg-slate-50">
                      <div className="text-sm font-semibold text-blue-600">{c.full_name ?? "—"}</div>
                      {c.title && <div className="text-xs text-slate-500">{c.title}</div>}
                      <div className="flex gap-3 text-xs text-slate-500">
                        {c.phone && (
                          <a href={`tel:${c.phone}`} className="text-blue-600 font-medium hover:underline">
                            {formatPhone(c.phone)}
                          </a>
                        )}
                        {c.email && <span>{c.email}</span>}
                        <span>Last touch: {formatDate(lastTouchPerContact.get(c.id) ?? null)}</span>
                      </div>
                    </a>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Properties tab ── */}
        {tab === "properties" && (
          <div>
            {properties.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No properties linked. Use <strong>+ Property</strong> to add one.
              </div>
            ) : (
              <>
                {/* Desktop */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-4 py-3 font-medium">Address</th>
                        <th className="px-4 py-3 font-medium">City</th>
                        <th className="px-4 py-3 font-medium">State</th>
                        <th className="px-4 py-3 font-medium">Zip</th>
                      </tr>
                    </thead>
                    <tbody>
                      {properties.map((p) => (
                        <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer" onClick={() => window.location.href = `/app/properties/${p.id}`}>
                          <td className="px-4 py-3 font-medium text-blue-600 hover:underline">{p.address_line1}</td>
                          <td className="px-4 py-3 text-slate-600">{p.city ?? "—"}</td>
                          <td className="px-4 py-3 text-slate-600">{p.state ?? "—"}</td>
                          <td className="px-4 py-3 text-slate-500">{p.postal_code ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Mobile */}
                <div className="md:hidden divide-y divide-slate-100">
                  {properties.map((p) => (
                    <a key={p.id} href={`/app/properties/${p.id}`} className="block px-4 py-3.5 hover:bg-slate-50">
                      <div className="text-sm font-semibold text-blue-600">{p.address_line1}</div>
                      <div className="text-xs text-slate-500">{[p.city, p.state, p.postal_code].filter(Boolean).join(", ")}</div>
                    </a>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Opportunities tab ── */}
        {tab === "opportunities" && (
          <div>
            {opportunities.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No opportunities yet. Create one from a property.
              </div>
            ) : (
              <>
                {/* Desktop */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-4 py-3 font-medium">Title / Property</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Est. Value</th>
                        <th className="px-4 py-3 font-medium">Opened</th>
                      </tr>
                    </thead>
                    <tbody>
                      {opportunities.map((o) => {
                        const prop = propertiesById.get(o.property_id);
                        return (
                          <tr key={o.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                            <td className="px-4 py-3 font-medium text-slate-900">
                              {o.title ?? (prop ? propertyLabel(prop) : "—")}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${OPP_STATUS_COLORS[o.status] ?? "bg-slate-100 text-slate-600"}`}>
                                {o.status.charAt(0).toUpperCase() + o.status.slice(1)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-600">{formatCurrency(o.estimated_value)}</td>
                            <td className="px-4 py-3 text-slate-500">{formatDate(o.opened_at)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Mobile */}
                <div className="md:hidden divide-y divide-slate-100">
                  {opportunities.map((o) => {
                    const prop = propertiesById.get(o.property_id);
                    return (
                      <div key={o.id} className="px-4 py-3.5 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">
                            {o.title ?? (prop ? propertyLabel(prop) : "—")}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${OPP_STATUS_COLORS[o.status] ?? "bg-slate-100 text-slate-600"}`}>
                            {o.status.charAt(0).toUpperCase() + o.status.slice(1)}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500">
                          {formatCurrency(o.estimated_value)} · Opened {formatDate(o.opened_at)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Timeline tab ── */}
        {tab === "timeline" && (
          <div>
            {touchpoints.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No touchpoints logged yet. Use <strong>Log Touchpoint</strong> to add one.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {touchpoints.map((tp) => {
                  const typeName = typesById.get(tp.touchpoint_type_id)?.name ?? "Touchpoint";
                  const outcomeName = tp.outcome_id ? outcomesById.get(tp.outcome_id)?.name ?? null : null;
                  const contactName = tp.contact_id ? contactsById.get(tp.contact_id)?.full_name ?? null : null;
                  const phase = tp.engagement_phase;

                  return (
                    <div key={tp.id} className="px-4 py-3.5 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">
                          {formatDate(tp.happened_at)}
                        </span>
                        <span className="text-sm text-slate-600">— {typeName}</span>
                        {outcomeName && (
                          <span className="text-sm text-slate-600">— {outcomeName}</span>
                        )}
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PHASE_COLORS[phase] ?? "bg-slate-100 text-slate-600"}`}>
                          {PHASE_LABELS[phase] ?? phase}
                        </span>
                      </div>
                      {tp.notes && (
                        <p className="text-sm text-slate-700">&ldquo;{tp.notes}&rdquo;</p>
                      )}
                      {contactName && (
                        <p className="text-xs text-slate-500">— {contactName}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

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
