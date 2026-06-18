"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { formatPhone } from "@/lib/utils/format";
import { BUILDING_TYPE_LABELS } from "@/app/app/properties/properties-client";
import CompletenessChip from "@/app/app/_components/completeness-chip";
import type { CompletenessResult } from "@/lib/completeness";

type Contact = {
  id: string;
  full_name: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  decision_role: string | null;
  account_id: string;
  updated_at: string;
};
type Account = { id: string; name: string | null; account_type: string | null };
type Property = {
  id: string;
  name: string | null;
  address_line1: string;
  city: string | null;
  state: string | null;
  building_type: string | null;
  is_primary: boolean;
};
type SearchProperty = {
  id: string;
  name: string | null;
  address_line1: string;
  city: string | null;
  state: string | null;
  building_type: string | null;
};
type Touchpoint = {
  id: string;
  happened_at: string;
  notes: string | null;
  engagement_phase: string;
  touchpoint_type_id: string;
  outcome_id: string | null;
  account_id: string | null;
  direction: string;
};

const INBOUND_TYPE_KEYS = ["call", "email", "text"];
type NextAction = {
  id: string;
  due_at: string;
  notes: string | null;
  status: string;
  property_id: string;
  recommended_touchpoint_type_id: string | null;
};
type TouchpointType = { id: string; name: string; key?: string | null; is_outreach: boolean };
type Outcome = { id: string; name: string; touchpoint_type_id?: string | null };

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

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDueDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (d < now) return { label: `Overdue · ${label}`, overdue: true };
  return { label: `Due ${label}`, overdue: false };
}

function propertyDisplayName(p: { name: string | null; address_line1: string }) {
  return p.name ?? p.address_line1;
}

function propertySecondary(p: { name: string | null; address_line1: string; city: string | null; state: string | null }) {
  // If name is the primary line, secondary shows full address line + city/state.
  // If address is the primary line (no name), secondary shows only city/state.
  if (p.name) {
    return [p.address_line1, p.city, p.state].filter(Boolean).join(", ");
  }
  return [p.city, p.state].filter(Boolean).join(", ");
}

function sanitizeSearch(q: string) {
  return q.replace(/[,()%]/g, "").trim();
}

export default function ContactDetailClient({
  completeness,
  contact,
  account,
  properties: initialProperties,
  touchpoints: initialTouchpoints,
  nextActions: initialNextActions,
  touchpointTypes,
  touchpointOutcomes,
  userId,
  orgId,
  userRole,
}: {
  completeness: CompletenessResult;
  contact: Contact;
  account: Account;
  properties: Property[];
  touchpoints: Touchpoint[];
  nextActions: NextAction[];
  touchpointTypes: TouchpointType[];
  touchpointOutcomes: Outcome[];
  userId: string;
  orgId: string;
  userRole: string;
}) {
  const supabase = createBrowserSupabase();

  const [localContact, setLocalContact] = useState(contact);
  const [touchpoints, setTouchpoints] = useState(initialTouchpoints);
  const [nextActions, setNextActions] = useState(initialNextActions);

  // Edit contact state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(contact.full_name ?? "");
  const [editTitle, setEditTitle] = useState(contact.title ?? "");
  const [editPhone, setEditPhone] = useState(contact.phone ?? "");
  const [editEmail, setEditEmail] = useState(contact.email ?? "");
  const [editRole, setEditRole] = useState(contact.decision_role ?? "");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function startEdit() {
    setEditName(localContact.full_name ?? "");
    setEditTitle(localContact.title ?? "");
    setEditPhone(localContact.phone ?? "");
    setEditEmail(localContact.email ?? "");
    setEditRole(localContact.decision_role ?? "");
    setEditError(null);
    setEditing(true);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editName.trim()) {
      setEditError("Name is required.");
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      const updates = {
        full_name: editName.trim(),
        title: editTitle.trim() || null,
        phone: editPhone.trim() || null,
        email: editEmail.trim() || null,
        decision_role: editRole || null,
      };
      const { error } = await supabase
        .from("contacts")
        .update(updates)
        .eq("id", contact.id);
      if (error) {
        setEditError(error.message);
        return;
      }
      setLocalContact((prev) => ({ ...prev, ...updates }));
      setEditing(false);
      showToast("success", "Contact updated.");
    } finally {
      setEditBusy(false);
    }
  }
  const [tab, setTab] = useState<"timeline" | "next_actions" | "properties">("timeline");
  const [activeAction, setActiveAction] = useState<"log" | "followup" | null>(null);
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  // Log touchpoint form
  const [logDirection, setLogDirection] = useState<"outbound" | "inbound">("outbound");
  const [logTypeId, setLogTypeId] = useState("");
  const [logOutcomeId, setLogOutcomeId] = useState("");
  const [logNotes, setLogNotes] = useState("");
  const [logBusy, setLogBusy] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  // Linked properties state
  const [localProperties, setLocalProperties] = useState(initialProperties);

  // Property linker (search + toggle) state
  const [linkerOpen, setLinkerOpen] = useState(false);
  const [propSearch, setPropSearch] = useState("");
  const [propResults, setPropResults] = useState<SearchProperty[]>([]);
  const [propSearching, setPropSearching] = useState(false);
  const [linkBusyId, setLinkBusyId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const propSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Schedule follow-up form
  const [fuPropertyId, setFuPropertyId] = useState(initialProperties[0]?.id ?? "");
  const [fuNotes, setFuNotes] = useState("");
  const [fuDueAt, setFuDueAt] = useState("");
  const [fuTypeId, setFuTypeId] = useState("");
  const [fuBusy, setFuBusy] = useState(false);
  const [fuError, setFuError] = useState<string | null>(null);

  function showToast(tone: "success" | "error", text: string) {
    setToast({ tone, text });
    setTimeout(() => setToast(null), 3000);
  }

  function toggleAction(action: "log" | "followup") {
    setActiveAction((prev) => (prev === action ? null : action));
    setLogError(null);
    setFuError(null);
  }

  // Debounced property search
  useEffect(() => {
    if (!linkerOpen) return;
    if (propSearchTimer.current) clearTimeout(propSearchTimer.current);
    propSearchTimer.current = setTimeout(async () => {
      const q = sanitizeSearch(propSearch);
      setPropSearching(true);
      try {
        let query = supabase
          .from("properties")
          .select("id,name,address_line1,city,state,building_type")
          .is("deleted_at", null)
          .order("name", { ascending: true, nullsFirst: false })
          .order("address_line1", { ascending: true })
          .limit(20);
        if (q) {
          query = query.or(`name.ilike.%${q}%,address_line1.ilike.%${q}%,city.ilike.%${q}%`);
        }
        const { data, error } = await query;
        if (error) { setLinkError(error.message); return; }
        setPropResults((data ?? []) as SearchProperty[]);
        setLinkError(null);
      } finally {
        setPropSearching(false);
      }
    }, 300);
    return () => {
      if (propSearchTimer.current) clearTimeout(propSearchTimer.current);
    };
  }, [propSearch, linkerOpen, supabase]);

  async function handleTogglePropertyLink(p: SearchProperty) {
    const isLinked = localProperties.some((lp) => lp.id === p.id);
    setLinkBusyId(p.id);
    setLinkError(null);
    try {
      if (isLinked) {
        // Soft-delete: preserve history and respect the composite PK.
        // Never hard-delete property_contacts (touchpoint/next_action history references it).
        const { error } = await supabase
          .from("property_contacts")
          .update({ active: false })
          .eq("contact_id", contact.id)
          .eq("property_id", p.id)
          .eq("org_id", orgId);
        if (error) { setLinkError(error.message); return; }
        setLocalProperties((prev) => prev.filter((lp) => lp.id !== p.id));
        showToast("success", "Property unlinked.");
      } else {
        const isFirst = localProperties.length === 0;
        const { error } = await supabase.rpc("rpc_upsert_property_contact", {
          p_property_id: p.id,
          p_contact_id: contact.id,
          p_role_category: "other",
          p_role_label: null,
          p_is_primary: isFirst,
          p_active: true,
        });
        if (error) { setLinkError(error.message); return; }
        setLocalProperties((prev) => [
          ...prev,
          { ...p, is_primary: isFirst },
        ]);
        showToast("success", "Property linked.");
      }
    } finally {
      setLinkBusyId(null);
    }
  }

  // Lookup maps
  const typeById = new Map(touchpointTypes.map((t) => [t.id, t]));
  const outcomeById = new Map(touchpointOutcomes.map((o) => [o.id, o]));
  const propertyById = new Map(localProperties.map((p) => [p.id, p]));

  const outreachTypes = touchpointTypes.filter((t) => t.is_outreach);
  const inboundTypes = touchpointTypes.filter(
    (t) => t.key && INBOUND_TYPE_KEYS.includes(t.key)
  );
  const logTypeOptions = logDirection === "inbound" ? inboundTypes : outreachTypes;
  const logOutcomes = touchpointOutcomes.filter(
    (o) => !logTypeId || o.touchpoint_type_id === logTypeId
  );

  function setDirection(dir: "outbound" | "inbound") {
    setLogDirection(dir);
    setLogTypeId("");
    setLogOutcomeId("");
    setLogError(null);
  }

  async function handleLogSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!logTypeId || !logNotes.trim()) {
      setLogError("Select a type and enter notes.");
      return;
    }
    setLogBusy(true);
    setLogError(null);
    try {
      const isInbound = logDirection === "inbound";
      const { data, error } = isInbound
        ? await supabase.rpc("rpc_log_inbound_touchpoint", {
            p_touchpoint_type_id: logTypeId,
            p_contact_id: contact.id,
            p_account_id: contact.account_id,
            p_outcome_id: logOutcomeId || null,
            p_notes: logNotes.trim(),
          })
        : await supabase.rpc("rpc_log_outreach_touchpoint", {
            p_contact_id: contact.id,
            p_account_id: contact.account_id,
            p_touchpoint_type_id: logTypeId,
            p_outcome_id: logOutcomeId || null,
            p_notes: logNotes.trim(),
            p_engagement_phase: "follow_up",
          });
      if (error) {
        setLogError(error.message);
        return;
      }
      const row = (Array.isArray(data) ? data[0] : data) as { touchpoint_id?: string } | null;
      const newTp: Touchpoint = {
        id: row?.touchpoint_id ?? crypto.randomUUID(),
        happened_at: new Date().toISOString(),
        notes: logNotes.trim(),
        engagement_phase: "follow_up",
        touchpoint_type_id: logTypeId,
        outcome_id: logOutcomeId || null,
        account_id: contact.account_id,
        direction: isInbound ? "inbound" : "outbound",
      };
      setTouchpoints((prev) => [newTp, ...prev]);
      setLogDirection("outbound");
      setLogTypeId("");
      setLogOutcomeId("");
      setLogNotes("");
      setActiveAction(null);
      setTab("timeline");
      showToast("success", isInbound ? "Inbound touchpoint logged." : "Touchpoint logged.");
    } finally {
      setLogBusy(false);
    }
  }

  async function handleFollowUpSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fuPropertyId || !fuDueAt) {
      setFuError("Property and due date are required.");
      return;
    }
    setFuBusy(true);
    setFuError(null);
    try {
      const { data, error } = await supabase.rpc("rpc_create_next_action", {
        p_property_id: fuPropertyId,
        p_contact_id: contact.id,
        p_due_at: new Date(fuDueAt).toISOString(),
        p_notes: fuNotes.trim() || null,
        p_recommended_touchpoint_type_id: fuTypeId || null,
      });
      if (error) {
        setFuError(error.message);
        return;
      }
      const row = data as NextAction;
      setNextActions((prev) => [...prev, row]);
      setFuNotes("");
      setFuDueAt("");
      setFuTypeId("");
      setActiveAction(null);
      setTab("next_actions");
      showToast("success", "Follow-up scheduled.");
    } finally {
      setFuBusy(false);
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

      {/* Back nav */}
      <a
        href="/app/contacts"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        ← Contacts
      </a>

      {/* Completeness */}
      {!editing && (
        <CompletenessChip score={completeness.score} missing={completeness.missing} onFix={() => setEditing(true)} />
      )}

      {/* Header card */}
      {editing ? (
        <form onSubmit={handleSaveEdit} className="rounded-2xl border border-blue-200 bg-blue-50 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">Edit Contact</h2>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Name *</label>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Full name"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Title</label>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="e.g. Facilities Director"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Phone</label>
              <input
                type="tel"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
              <input
                type="email"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Role</label>
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              value={editRole}
              onChange={(e) => setEditRole(e.target.value)}
            >
              <option value="">Unspecified</option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          {editError && <p className="text-xs text-red-600">{editError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={editBusy}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {editBusy ? "Saving…" : "Save Changes"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-slate-900">{localContact.full_name ?? "—"}</h1>
              {localContact.title && <p className="text-sm text-slate-500">{localContact.title}</p>}
              <a
                href={`/app/accounts/${account.id}`}
                className="mt-1 inline-block text-sm text-blue-600 hover:underline"
              >
                {account.name ?? "Unknown account"}
              </a>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-600">
                {localContact.phone && (
                  <a href={`tel:${localContact.phone}`} className="text-blue-600 font-medium hover:underline">
                    {formatPhone(localContact.phone)}
                  </a>
                )}
                {localContact.email && (
                  <a href={`mailto:${localContact.email}`} className="text-blue-600 hover:underline">
                    {localContact.email}
                  </a>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {localContact.decision_role && (
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    ROLE_COLORS[localContact.decision_role] ?? "bg-gray-100 text-gray-600"
                  }`}
                >
                  {ROLE_LABELS[localContact.decision_role] ?? localContact.decision_role}
                </span>
              )}
              <button
                type="button"
                onClick={startEdit}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => toggleAction("log")}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
            activeAction === "log"
              ? "bg-blue-600 text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          Log Touchpoint
        </button>
        <button
          onClick={() => toggleAction("followup")}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
            activeAction === "followup"
              ? "bg-blue-600 text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          Schedule Follow-Up
        </button>
      </div>

      {/* Log Touchpoint form */}
      {activeAction === "log" && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Log Touchpoint</h2>
          <form onSubmit={handleLogSubmit} className="space-y-3">
            {/* Direction toggle */}
            <div>
              <p className="mb-2 text-xs font-medium text-slate-600">Direction</p>
              <div className="flex gap-2">
                {([
                  { value: "outbound", label: "Outbound" },
                  { value: "inbound", label: "Inbound" },
                ] as const).map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => setDirection(d.value)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      logDirection === d.value
                        ? "bg-blue-600 text-white"
                        : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              {logDirection === "inbound" && (
                <p className="mt-1.5 text-xs text-slate-500">
                  Logs a call/email/text this contact initiated. Visibility only — no points or outreach credit.
                </p>
              )}
            </div>
            {/* Type chips */}
            <div>
              <p className="mb-2 text-xs font-medium text-slate-600">Type *</p>
              <div className="flex flex-wrap gap-2">
                {logTypeOptions.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setLogTypeId(t.id);
                      setLogOutcomeId("");
                    }}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      logTypeId === t.id
                        ? "bg-blue-600 text-white"
                        : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
            {/* Outcome chips */}
            {logTypeId && logOutcomes.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-slate-600">Outcome</p>
                <div className="flex flex-wrap gap-2">
                  {logOutcomes.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setLogOutcomeId(logOutcomeId === o.id ? "" : o.id)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        logOutcomeId === o.id
                          ? "bg-blue-600 text-white"
                          : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {o.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Notes */}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Notes *</label>
              <textarea
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                rows={3}
                value={logNotes}
                onChange={(e) => setLogNotes(e.target.value)}
                placeholder="What happened?"
              />
            </div>
            {logError && <p className="text-xs text-red-600">{logError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={logBusy}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {logBusy ? "Saving…" : "Log Touchpoint"}
              </button>
              <button
                type="button"
                onClick={() => setActiveAction(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Schedule Follow-Up form */}
      {activeAction === "followup" && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Schedule Follow-Up</h2>
          {localProperties.length === 0 ? (
            <p className="text-sm text-slate-600">
              No properties linked to this contact. Link a property first to schedule a
              follow-up.
            </p>
          ) : (
            <form onSubmit={handleFollowUpSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Due date *</label>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                    value={fuDueAt}
                    onChange={(e) => setFuDueAt(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Property *</label>
                  <select
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                    value={fuPropertyId}
                    onChange={(e) => setFuPropertyId(e.target.value)}
                  >
                    {localProperties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.address_line1}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {/* Touchpoint type chips (all types) */}
              <div>
                <p className="mb-2 text-xs font-medium text-slate-600">Type (optional)</p>
                <div className="flex flex-wrap gap-2">
                  {touchpointTypes.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setFuTypeId(fuTypeId === t.id ? "" : t.id)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        fuTypeId === t.id
                          ? "bg-blue-600 text-white"
                          : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Notes</label>
                <textarea
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  rows={2}
                  value={fuNotes}
                  onChange={(e) => setFuNotes(e.target.value)}
                  placeholder="What to follow up on?"
                />
              </div>
              {fuError && <p className="text-xs text-red-600">{fuError}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={fuBusy}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {fuBusy ? "Scheduling…" : "Schedule Follow-Up"}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveAction(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <div className="flex gap-0">
          {(
            [
              { key: "timeline", label: `Timeline (${touchpoints.length})` },
              { key: "next_actions", label: `Follow-Ups (${nextActions.length})` },
              { key: "properties", label: `Properties (${localProperties.length})` },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === key
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab: Timeline */}
      {tab === "timeline" && (
        <div className="space-y-3">
          {touchpoints.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No touchpoints logged for this contact yet.
            </p>
          ) : (
            touchpoints.map((tp) => {
              const type = typeById.get(tp.touchpoint_type_id);
              const outcome = tp.outcome_id ? outcomeById.get(tp.outcome_id) : null;
              return (
                <div key={tp.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500">{formatDate(tp.happened_at)}</span>
                    {type && (
                      <span className="text-xs font-medium text-slate-700">{type.name}</span>
                    )}
                    {tp.direction === "inbound" && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        ↙ Inbound
                      </span>
                    )}
                    {outcome && (
                      <span className="text-xs text-slate-600">— {outcome.name}</span>
                    )}
                    {tp.engagement_phase && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          PHASE_COLORS[tp.engagement_phase] ?? "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {PHASE_LABELS[tp.engagement_phase] ?? tp.engagement_phase}
                      </span>
                    )}
                  </div>
                  {tp.notes && <p className="text-sm text-slate-700">{tp.notes}</p>}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Tab: Next Actions */}
      {tab === "next_actions" && (
        <div className="space-y-3">
          {nextActions.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No open follow-ups for this contact.
            </p>
          ) : (
            nextActions.map((na) => {
              const { label: dueLabel, overdue } = formatDueDate(na.due_at);
              const prop = propertyById.get(na.property_id);
              const recType = na.recommended_touchpoint_type_id
                ? typeById.get(na.recommended_touchpoint_type_id)
                : null;
              return (
                <div key={na.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span
                      className={`text-xs font-medium ${overdue ? "text-red-600" : "text-slate-700"}`}
                    >
                      {dueLabel}
                    </span>
                    {prop && (
                      <span className="text-xs text-slate-500">
                        {prop.address_line1}
                        {prop.city ? ` · ${prop.city}` : ""}
                        {prop.state ? ` ${prop.state}` : ""}
                      </span>
                    )}
                    {recType && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {recType.name}
                      </span>
                    )}
                  </div>
                  {na.notes && <p className="text-sm text-slate-700">{na.notes}</p>}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Tab: Properties */}
      {tab === "properties" && (
        <div className="space-y-3">
          {/* Link Property button + search panel — above the list for discoverability */}
          {!linkerOpen ? (
            <button
              type="button"
              onClick={() => {
                setLinkerOpen(true);
                setLinkError(null);
              }}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              + Link Property
            </button>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-600">
                  {localProperties.length} {localProperties.length === 1 ? "property" : "properties"} linked
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setLinkerOpen(false);
                    setPropSearch("");
                    setPropResults([]);
                  }}
                  className="text-xs text-slate-500 hover:text-slate-700"
                >
                  Close
                </button>
              </div>
              <input
                type="text"
                autoFocus
                value={propSearch}
                onChange={(e) => setPropSearch(e.target.value)}
                placeholder="Search by name, address, or city…"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              />
              {linkError && <p className="text-xs text-red-600">{linkError}</p>}
              <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
                {propSearching && propResults.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-slate-500">Searching…</p>
                ) : propResults.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-slate-500">
                    {propSearch ? "No properties match." : "Start typing to search properties."}
                  </p>
                ) : (
                  propResults.map((p) => {
                    const isLinked = localProperties.some((lp) => lp.id === p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={linkBusyId === p.id}
                        onClick={() => handleTogglePropertyLink(p)}
                        className="flex w-full items-start gap-3 border-b border-slate-100 px-3 py-2.5 text-left last:border-b-0 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-300">
                          {isLinked && (
                            <svg className="h-4 w-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900">
                            {propertyDisplayName(p)}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {propertySecondary(p)}
                            {p.building_type && (
                              <span className="ml-1 text-slate-400">
                                · {BUILDING_TYPE_LABELS[p.building_type] ?? p.building_type}
                              </span>
                            )}
                          </p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Linked property chips */}
          {localProperties.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No properties linked to this contact.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {localProperties.map((p) => (
                <div
                  key={p.id}
                  className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2"
                >
                  <a
                    href={`/app/properties/${p.id}`}
                    className="min-w-0 flex-1"
                  >
                    <p className="truncate text-sm font-semibold text-slate-900 hover:text-blue-600 hover:underline">
                      {propertyDisplayName(p)}
                      {p.is_primary && (
                        <span className="ml-1.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 align-middle">
                          Primary
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {propertySecondary(p)}
                      {p.building_type && (
                        <span className="ml-1 text-slate-400">
                          · {BUILDING_TYPE_LABELS[p.building_type] ?? p.building_type}
                        </span>
                      )}
                    </p>
                  </a>
                  <button
                    type="button"
                    aria-label={`Unlink ${propertyDisplayName(p)}`}
                    disabled={linkBusyId === p.id}
                    onClick={(e) => {
                      e.preventDefault();
                      handleTogglePropertyLink({
                        id: p.id,
                        name: p.name,
                        address_line1: p.address_line1,
                        city: p.city,
                        state: p.state,
                        building_type: p.building_type,
                      });
                    }}
                    className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.28 3.22a.75.75 0 00-1.06 1.06L8.94 10l-5.72 5.72a.75.75 0 101.06 1.06L10 11.06l5.72 5.72a.75.75 0 101.06-1.06L11.06 10l5.72-5.72a.75.75 0 00-1.06-1.06L10 8.94 4.28 3.22z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
