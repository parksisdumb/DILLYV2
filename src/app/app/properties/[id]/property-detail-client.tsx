"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { PropContact } from "./page";

type Property = {
  id: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  primary_account_id: string | null;
  notes: string | null;
  roof_type: string | null;
  roof_age_years: number | null;
  sq_footage: number | null;
};
type Account = { id: string; name: string | null; account_type: string | null } | null;
type Opportunity = {
  id: string;
  title: string | null;
  status: string;
  estimated_value: number | null;
  scope_type_id: string;
  stage_id: string;
  primary_contact_id: string | null;
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
type TouchpointType = { id: string; name: string; key?: string | null; is_outreach: boolean };
type Outcome = { id: string; name: string; touchpoint_type_id?: string | null };
type ScopeType = { id: string; name: string; key: string };
type Stage = { id: string; name: string; key: string; is_closed_stage: boolean };

const ROOF_TYPE_LABELS: Record<string, string> = {
  flat: "Flat",
  tpo: "TPO",
  epdm: "EPDM",
  metal: "Metal",
  built_up: "Built-Up",
  other: "Other",
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
  open: "bg-green-100 text-green-700",
  won: "bg-blue-100 text-blue-700",
  lost: "bg-slate-100 text-slate-500",
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCurrency(value: number | null) {
  if (value == null) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export default function PropertyDetailClient({
  property,
  account,
  propContacts,
  opportunities: initialOpportunities,
  touchpoints: initialTouchpoints,
  touchpointTypes,
  touchpointOutcomes,
  scopeTypes,
  stages,
  orgId,
  userId,
  userRole,
  availableContacts,
  allAccounts,
}: {
  property: Property;
  account: Account;
  propContacts: PropContact[];
  opportunities: Opportunity[];
  touchpoints: Touchpoint[];
  touchpointTypes: TouchpointType[];
  touchpointOutcomes: Outcome[];
  scopeTypes: ScopeType[];
  stages: Stage[];
  orgId: string;
  userId: string;
  userRole: string;
  availableContacts: { id: string; full_name: string | null }[];
  allAccounts: { id: string; name: string | null; account_type: string | null }[];
}) {
  const supabase = createBrowserSupabase();

  const [opportunities, setOpportunities] = useState(initialOpportunities);
  const [touchpoints, setTouchpoints] = useState(initialTouchpoints);
  const [tab, setTab] = useState<"opportunities" | "contacts" | "timeline">("opportunities");
  const [activeAction, setActiveAction] = useState<"log" | "opportunity" | null>(null);
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  // Link contact state (declared early — other state depends on localPropContacts)
  const [linkContactId, setLinkContactId] = useState("");
  const [linkRoleLabel, setLinkRoleLabel] = useState("");
  const [linkPrimary, setLinkPrimary] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [localPropContacts, setLocalPropContacts] = useState(propContacts);
  const [localAvailable, setLocalAvailable] = useState(availableContacts);

  // Link account state
  const [localAccount, setLocalAccount] = useState(account);
  const [linkAccountId, setLinkAccountId] = useState("");
  const [linkAccountBusy, setLinkAccountBusy] = useState(false);
  const [linkAccountError, setLinkAccountError] = useState<string | null>(null);
  const [showLinkAccount, setShowLinkAccount] = useState(false);

  // Log touchpoint form
  const [logTypeId, setLogTypeId] = useState("");
  const [logContactId, setLogContactId] = useState(localPropContacts[0]?.contact_id ?? "");
  const [logOutcomeId, setLogOutcomeId] = useState("");
  const [logPhase, setLogPhase] = useState("visibility");
  const [logNotes, setLogNotes] = useState("");
  const [logBusy, setLogBusy] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  // Create opportunity form
  const openStages = stages.filter((s) => !s.is_closed_stage);
  const [oppTitle, setOppTitle] = useState("");
  const [oppScopeId, setOppScopeId] = useState("");
  const [oppStageId, setOppStageId] = useState(openStages[0]?.id ?? "");
  const [oppValue, setOppValue] = useState("");
  const [oppContactId, setOppContactId] = useState("");
  const [oppBusy, setOppBusy] = useState(false);
  const [oppError, setOppError] = useState<string | null>(null);

  function showToast(tone: "success" | "error", text: string) {
    setToast({ tone, text });
    setTimeout(() => setToast(null), 3000);
  }

  function toggleAction(action: "log" | "opportunity") {
    setActiveAction((prev) => (prev === action ? null : action));
    setLogError(null);
    setOppError(null);
  }

  // Lookup maps
  const typeById = new Map(touchpointTypes.map((t) => [t.id, t]));
  const outcomeById = new Map(touchpointOutcomes.map((o) => [o.id, o]));
  const scopeById = new Map(scopeTypes.map((s) => [s.id, s]));
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const contactNameById = new Map(localPropContacts.map((pc) => [pc.contact_id, pc.contact.full_name]));

  const selectedType = logTypeId ? typeById.get(logTypeId) : null;
  const logOutcomes = touchpointOutcomes.filter(
    (o) => !logTypeId || o.touchpoint_type_id === logTypeId,
  );
  const phaseOptions = selectedType?.is_outreach
    ? [
        { value: "first_touch", label: "First Touch" },
        { value: "follow_up", label: "Follow Up" },
      ]
    : [
        { value: "first_touch", label: "First Touch" },
        { value: "follow_up", label: "Follow Up" },
        { value: "visibility", label: "Visibility" },
      ];

  function handleTypeSelect(typeId: string) {
    const t = typeById.get(typeId);
    setLogTypeId(typeId);
    setLogOutcomeId("");
    setLogPhase(t?.is_outreach ? "follow_up" : "visibility");
  }

  function resetOppForm() {
    setOppTitle("");
    setOppScopeId("");
    setOppStageId(openStages[0]?.id ?? "");
    setOppValue("");
    setOppContactId("");
    setOppError(null);
  }

  async function handleLinkContact(e: React.FormEvent) {
    e.preventDefault();
    if (!linkContactId) { setLinkError("Select a contact."); return; }
    setLinkBusy(true);
    setLinkError(null);
    try {
      const { error } = await supabase.rpc("rpc_upsert_property_contact", {
        p_property_id: property.id,
        p_contact_id: linkContactId,
        p_role_category: "decision_maker",
        p_role_label: linkRoleLabel.trim() || null,
        p_is_primary: linkPrimary,
      });
      if (error) { setLinkError(error.message); return; }

      const linked = localAvailable.find((c) => c.id === linkContactId);
      if (linked) {
        setLocalPropContacts((prev) => [
          ...prev,
          {
            contact_id: linked.id,
            role_label: linkRoleLabel.trim() || null,
            is_primary: linkPrimary,
            contact: { id: linked.id, full_name: linked.full_name, account_id: "" },
          },
        ]);
        setLocalAvailable((prev) => prev.filter((c) => c.id !== linkContactId));
      }
      setLinkContactId("");
      setLinkRoleLabel("");
      setLinkPrimary(false);
      showToast("success", "Contact linked.");
    } finally {
      setLinkBusy(false);
    }
  }

  async function handleLinkAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!linkAccountId) { setLinkAccountError("Select an account."); return; }
    setLinkAccountBusy(true);
    setLinkAccountError(null);
    try {
      const { error } = await supabase
        .from("properties")
        .update({ primary_account_id: linkAccountId })
        .eq("id", property.id);
      if (error) { setLinkAccountError(error.message); return; }

      const linked = allAccounts.find((a) => a.id === linkAccountId);
      if (linked) {
        setLocalAccount({ id: linked.id, name: linked.name, account_type: linked.account_type });
      }
      setLinkAccountId("");
      setShowLinkAccount(false);
      showToast("success", "Account linked.");
    } finally {
      setLinkAccountBusy(false);
    }
  }

  async function handleLogSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!logTypeId) {
      setLogError("Select a touchpoint type.");
      return;
    }
    if (selectedType?.is_outreach && !logContactId) {
      setLogError("Contact is required for outreach touchpoints.");
      return;
    }
    if (selectedType?.is_outreach && !logNotes.trim()) {
      setLogError("Notes are required.");
      return;
    }
    setLogBusy(true);
    setLogError(null);
    try {
      let tpId: string | null = null;

      if (selectedType?.is_outreach) {
        const pc = localPropContacts.find((p) => p.contact_id === logContactId);
        const { data, error } = await supabase.rpc("rpc_log_outreach_touchpoint", {
          p_contact_id: logContactId,
          p_account_id: pc!.contact.account_id,
          p_touchpoint_type_id: logTypeId,
          p_property_id: property.id,
          p_outcome_id: logOutcomeId || null,
          p_notes: logNotes.trim(),
          p_engagement_phase: logPhase as "first_touch" | "follow_up",
        });
        if (error) { setLogError(error.message); return; }
        tpId = (data as { touchpoint: { id: string } } | null)?.touchpoint?.id ?? null;
      } else {
        const { data, error } = await supabase.rpc("rpc_log_touchpoint", {
          p_property_id: property.id,
          p_touchpoint_type_id: logTypeId,
          p_contact_id: logContactId || null,
          p_outcome_id: logOutcomeId || null,
          p_notes: logNotes.trim() || null,
          p_engagement_phase: logPhase as "first_touch" | "follow_up" | "visibility",
        });
        if (error) { setLogError(error.message); return; }
        tpId = (data as { touchpoint_id: string } | null)?.touchpoint_id ?? null;
      }

      const newTp: Touchpoint = {
        id: tpId ?? crypto.randomUUID(),
        happened_at: new Date().toISOString(),
        notes: logNotes.trim() || null,
        engagement_phase: logPhase,
        touchpoint_type_id: logTypeId,
        outcome_id: logOutcomeId || null,
        contact_id: logContactId || null,
      };
      setTouchpoints((prev) => [newTp, ...prev]);
      setLogTypeId("");
      setLogContactId(localPropContacts[0]?.contact_id ?? "");
      setLogOutcomeId("");
      setLogPhase("visibility");
      setLogNotes("");
      setActiveAction(null);
      setTab("timeline");
      showToast("success", "Touchpoint logged.");
    } finally {
      setLogBusy(false);
    }
  }

  async function handleOppSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!oppScopeId || !oppStageId) {
      setOppError("Scope and stage are required.");
      return;
    }
    setOppBusy(true);
    setOppError(null);
    try {
      const { data, error } = await supabase
        .from("opportunities")
        .insert({
          org_id: orgId,
          property_id: property.id,
          scope_type_id: oppScopeId,
          stage_id: oppStageId,
          title: oppTitle.trim() || null,
          estimated_value: oppValue ? parseFloat(oppValue) : null,
          primary_contact_id: oppContactId || null,
        })
        .select("id")
        .single();

      if (error) { setOppError(error.message); return; }

      const newOpp: Opportunity = {
        id: (data as { id: string }).id,
        title: oppTitle.trim() || null,
        status: "open",
        estimated_value: oppValue ? parseFloat(oppValue) : null,
        scope_type_id: oppScopeId,
        stage_id: oppStageId,
        primary_contact_id: oppContactId || null,
      };
      setOpportunities((prev) => [newOpp, ...prev]);
      resetOppForm();
      setActiveAction(null);
      setTab("opportunities");
      showToast("success", "Opportunity created.");
    } finally {
      setOppBusy(false);
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
        href="/app/properties"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        ← Properties
      </a>

      {/* Header card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h1 className="text-xl font-semibold text-slate-900">{property.address_line1}</h1>
        {property.address_line2 && (
          <p className="text-sm text-slate-500">{property.address_line2}</p>
        )}
        <p className="text-sm text-slate-500">
          {property.city}, {property.state} {property.postal_code}
        </p>
        {localAccount ? (
          <div className="mt-1 flex items-center gap-2">
            <a
              href={`/app/accounts/${localAccount.id}`}
              className="text-sm text-blue-600 hover:underline"
            >
              {localAccount.name ?? "Unknown account"}
            </a>
            <button
              type="button"
              onClick={() => setShowLinkAccount(!showLinkAccount)}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              (change)
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowLinkAccount(!showLinkAccount)}
            className="mt-1 inline-block text-sm text-blue-600 hover:underline"
          >
            + Link Account
          </button>
        )}
        {/* Roof metadata badges */}
        {(property.roof_type || property.roof_age_years || property.sq_footage) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {property.roof_type && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {ROOF_TYPE_LABELS[property.roof_type] ?? property.roof_type}
              </span>
            )}
            {property.roof_age_years != null && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {property.roof_age_years} yr{property.roof_age_years !== 1 ? "s" : ""}
              </span>
            )}
            {property.sq_footage != null && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {property.sq_footage.toLocaleString()} sqft
              </span>
            )}
          </div>
        )}
        {property.notes && (
          <p className="mt-2 text-sm text-slate-600">{property.notes}</p>
        )}
      </div>

      {/* Link Account form */}
      {showLinkAccount && (
        <form onSubmit={handleLinkAccount} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <p className="text-xs font-medium text-slate-600">Link an account to this property</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <select
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              value={linkAccountId}
              onChange={(e) => setLinkAccountId(e.target.value)}
            >
              <option value="">Select account...</option>
              {allAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ?? "Unnamed"}{a.account_type ? ` (${a.account_type})` : ""}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={linkAccountBusy}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {linkAccountBusy ? "Linking..." : "Link"}
              </button>
              <button
                type="button"
                onClick={() => { setShowLinkAccount(false); setLinkAccountError(null); }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
          {linkAccountError && <p className="text-xs text-red-600">{linkAccountError}</p>}
        </form>
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
          onClick={() => {
            toggleAction("opportunity");
            if (activeAction !== "opportunity") resetOppForm();
          }}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
            activeAction === "opportunity"
              ? "bg-blue-600 text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          Create Opportunity
        </button>
      </div>

      {/* Log Touchpoint form */}
      {activeAction === "log" && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Log Touchpoint</h2>
          <form onSubmit={handleLogSubmit} className="space-y-3">
            {/* Type chips */}
            <div>
              <p className="mb-2 text-xs font-medium text-slate-600">Type *</p>
              <div className="flex flex-wrap gap-2">
                {touchpointTypes.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleTypeSelect(t.id)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      logTypeId === t.id
                        ? "bg-blue-600 text-white"
                        : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
            {/* Contact selector */}
            {localPropContacts.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Contact{selectedType?.is_outreach ? " *" : " (optional)"}
                </label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={logContactId}
                  onChange={(e) => setLogContactId(e.target.value)}
                >
                  {!selectedType?.is_outreach && <option value="">None</option>}
                  {localPropContacts.map((pc) => (
                    <option key={pc.contact_id} value={pc.contact_id}>
                      {pc.contact.full_name ?? "Unknown"}
                      {pc.role_label ? ` (${pc.role_label})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {localPropContacts.length === 0 && selectedType?.is_outreach && (
              <p className="text-xs text-amber-600">
                No contacts linked to this property. Outreach requires a contact.
              </p>
            )}
            {/* Phase */}
            {logTypeId && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Phase</label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={logPhase}
                  onChange={(e) => setLogPhase(e.target.value)}
                >
                  {phaseOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
                          : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
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
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Notes{selectedType?.is_outreach ? " *" : ""}
              </label>
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

      {/* Create Opportunity form */}
      {activeAction === "opportunity" && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Create Opportunity</h2>
          <form onSubmit={handleOppSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Title (optional)
              </label>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                value={oppTitle}
                onChange={(e) => setOppTitle(e.target.value)}
                placeholder="e.g. Flat roof replacement"
              />
            </div>
            {/* Scope chips */}
            <div>
              <p className="mb-2 text-xs font-medium text-slate-600">Scope *</p>
              <div className="flex flex-wrap gap-2">
                {scopeTypes.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setOppScopeId(s.id)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      oppScopeId === s.id
                        ? "bg-blue-600 text-white"
                        : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Stage *</label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={oppStageId}
                  onChange={(e) => setOppStageId(e.target.value)}
                >
                  {openStages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Est. Value ($)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={oppValue}
                  onChange={(e) => setOppValue(e.target.value)}
                  placeholder="125000"
                />
              </div>
            </div>
            {localPropContacts.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Primary Contact (optional)
                </label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={oppContactId}
                  onChange={(e) => setOppContactId(e.target.value)}
                >
                  <option value="">None</option>
                  {localPropContacts.map((pc) => (
                    <option key={pc.contact_id} value={pc.contact_id}>
                      {pc.contact.full_name ?? "Unknown"}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {oppError && <p className="text-xs text-red-600">{oppError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={oppBusy}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {oppBusy ? "Creating…" : "Create Opportunity"}
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

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <div className="flex">
          {(
            [
              { key: "opportunities", label: `Opportunities (${opportunities.length})` },
              { key: "contacts", label: `Contacts (${localPropContacts.length})` },
              { key: "timeline", label: `Timeline (${touchpoints.length})` },
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

      {/* Tab: Opportunities */}
      {tab === "opportunities" && (
        <div className="space-y-3">
          {opportunities.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No opportunities yet. Create one to start tracking this property.
            </p>
          ) : (
            opportunities.map((opp) => {
              const scope = scopeById.get(opp.scope_type_id);
              const stage = stageById.get(opp.stage_id);
              const contactName = opp.primary_contact_id
                ? contactNameById.get(opp.primary_contact_id)
                : null;
              return (
                <div key={opp.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {scope && (
                          <span className="font-medium text-slate-800">{scope.name}</span>
                        )}
                        {stage && (
                          <span className="text-xs text-slate-500">· {stage.name}</span>
                        )}
                      </div>
                      {opp.title && (
                        <p className="mt-0.5 text-sm text-slate-600">{opp.title}</p>
                      )}
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                        {opp.estimated_value != null && (
                          <span>{formatCurrency(opp.estimated_value)} est.</span>
                        )}
                        {contactName && <span>{contactName}</span>}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                        OPP_STATUS_COLORS[opp.status] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {opp.status}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Tab: Contacts */}
      {tab === "contacts" && (
        <div className="space-y-3">
          {/* Link contact form */}
          {localAvailable.length > 0 && (
            <form onSubmit={handleLinkContact} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
              <p className="text-xs font-medium text-slate-600">Link a contact to this property</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <select
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={linkContactId}
                  onChange={(e) => setLinkContactId(e.target.value)}
                >
                  <option value="">Select contact…</option>
                  {localAvailable.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name ?? c.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
                <input
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  value={linkRoleLabel}
                  onChange={(e) => setLinkRoleLabel(e.target.value)}
                  placeholder="Role (optional)"
                />
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={linkPrimary}
                      onChange={(e) => setLinkPrimary(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    Primary
                  </label>
                  <button
                    type="submit"
                    disabled={linkBusy}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {linkBusy ? "Linking…" : "Link"}
                  </button>
                </div>
              </div>
              {linkError && <p className="text-xs text-red-600">{linkError}</p>}
            </form>
          )}

          {localPropContacts.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No contacts linked to this property.
            </p>
          ) : (
            localPropContacts.map((pc) => (
              <a
                key={pc.contact_id}
                href={`/app/contacts/${pc.contact_id}`}
                className="block rounded-2xl border border-slate-200 bg-white p-4 hover:bg-slate-50"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-900">
                    {pc.contact.full_name ?? "Unknown"}
                  </span>
                  {pc.role_label && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {pc.role_label}
                    </span>
                  )}
                  {pc.is_primary && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                      Primary
                    </span>
                  )}
                </div>
              </a>
            ))
          )}
        </div>
      )}

      {/* Tab: Timeline */}
      {tab === "timeline" && (
        <div className="space-y-3">
          {touchpoints.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No touchpoints logged for this property yet.
            </p>
          ) : (
            touchpoints.map((tp) => {
              const type = typeById.get(tp.touchpoint_type_id);
              const outcome = tp.outcome_id ? outcomeById.get(tp.outcome_id) : null;
              const contactName = tp.contact_id ? contactNameById.get(tp.contact_id) : null;
              return (
                <div key={tp.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500">{formatDate(tp.happened_at)}</span>
                    {type && (
                      <span className="text-xs font-medium text-slate-700">{type.name}</span>
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
                    {contactName && (
                      <span className="text-xs text-slate-500">{contactName}</span>
                    )}
                  </div>
                  {tp.notes && <p className="text-sm text-slate-700">{tp.notes}</p>}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
