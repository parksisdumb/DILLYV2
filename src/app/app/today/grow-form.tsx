"use client";

import { useMemo, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

// ── Types ──────────────────────────────────────────────────────────────────

type Account = { id: string; name: string | null };
type Contact = { id: string; full_name: string | null; account_id: string };
type Property = { id: string; address_line1: string; city: string | null; state: string | null };
type TouchpointType = { id: string; name: string; key?: string | null; is_outreach: boolean };
type Outcome = { id: string; name: string; touchpoint_type_id?: string | null };

type OutreachResult = {
  awarded_points: number;
  outreach_count_today: number;
  outreach_target: number;
  outreach_remaining: number;
};

type Props = {
  userId: string;
  orgId: string;
  contacts: Contact[];
  accounts: Account[];
  accountsById: Map<string, Account>;
  properties: Property[];
  outreachTypes: TouchpointType[];
  outcomes: Outcome[];
  onSuccess: (result: OutreachResult) => void;
};

// ── Helpers ────────────────────────────────────────────────────────────────

const input =
  "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none";

const chipBtn = (active: boolean) =>
  [
    "rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
    active
      ? "border-blue-600 bg-blue-600 text-white"
      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
  ].join(" ");

const sectionLabel = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500";

function propertyLabel(p: Property) {
  return [p.address_line1, p.city, p.state].filter(Boolean).join(", ");
}

function localDateValue(offsetDays = 1) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// ── Component ──────────────────────────────────────────────────────────────

export default function GrowForm({
  userId,
  orgId,
  contacts,
  accounts,
  accountsById,
  properties,
  outreachTypes,
  outcomes,
  onSuccess,
}: Props) {
  const supabase = useMemo(() => createBrowserSupabase(), []);

  // ── Collapsed state ──
  const [open, setOpen] = useState(true);

  // ── Contact search ──
  const [contactQuery, setContactQuery] = useState("");
  const [selectedContactId, setSelectedContactId] = useState("");
  const [selectedContactName, setSelectedContactName] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedAccountName, setSelectedAccountName] = useState("");
  const [showContactResults, setShowContactResults] = useState(false);

  // ── Outreach type + outcome ──
  const [typeId, setTypeId] = useState("");
  const [outcomeId, setOutcomeId] = useState("");

  // ── Notes ──
  const [notes, setNotes] = useState("");

  // ── Property (optional, collapsible) ──
  const [propertyOpen, setPropertyOpen] = useState(false);
  const [propertyQuery, setPropertyQuery] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState("");

  // ── Follow-up toggle ──
  const [followUp, setFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState(localDateValue(1));
  const [followUpNotes, setFollowUpNotes] = useState("");

  // ── Submission state ──
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OutreachResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── New account/contact modal ──
  const [showNewFlow, setShowNewFlow] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountType, setNewAccountType] = useState("");
  const [newAccountBusy, setNewAccountBusy] = useState(false);
  const [newAccountId, setNewAccountId] = useState(""); // created account id
  const [newAccountName_saved, setNewAccountName_saved] = useState(""); // for display
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newContactBusy, setNewContactBusy] = useState(false);
  const [newFlowStep, setNewFlowStep] = useState<"account" | "contact">("account");
  const [newFlowError, setNewFlowError] = useState<string | null>(null);
  const [accountQuery, setAccountQuery] = useState("");
  const [accountCreateMode, setAccountCreateMode] = useState(false);

  // ── Derived values ──
  const filteredContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    if (!q) return [];
    return contacts
      .filter((c) => (c.full_name || "").toLowerCase().includes(q))
      .slice(0, 6);
  }, [contacts, contactQuery]);

  const filteredOutcomes = useMemo(() => {
    if (!typeId) return [];
    const typeSpecific = outcomes.filter((o) => o.touchpoint_type_id === typeId);
    return typeSpecific.length > 0 ? typeSpecific : outcomes;
  }, [outcomes, typeId]);

  const filteredProperties = useMemo(() => {
    const q = propertyQuery.trim().toLowerCase();
    if (!q) return properties.slice(0, 6);
    return properties
      .filter((p) =>
        [p.address_line1, p.city, p.state]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 6);
  }, [properties, propertyQuery]);

  const selectedProperty = properties.find((p) => p.id === selectedPropertyId) ?? null;

  const filteredAccounts = useMemo(() => {
    const q = accountQuery.trim().toLowerCase();
    if (!q) return [];
    return accounts
      .filter((a) => (a.name || "").toLowerCase().includes(q))
      .slice(0, 6);
  }, [accounts, accountQuery]);

  const canSubmit =
    selectedContactId.length > 0 &&
    selectedAccountId.length > 0 &&
    typeId.length > 0 &&
    notes.trim().length > 0;

  // ── Contact selection ──
  function selectContact(c: Contact) {
    setSelectedContactId(c.id);
    setSelectedContactName(c.full_name || "Unnamed");
    setSelectedAccountId(c.account_id);
    setSelectedAccountName(accountsById.get(c.account_id)?.name ?? "");
    setContactQuery("");
    setShowContactResults(false);
  }

  function clearContact() {
    setSelectedContactId("");
    setSelectedContactName("");
    setSelectedAccountId("");
    setSelectedAccountName("");
  }

  // ── Existing account selection (in new contact flow) ──
  function selectExistingAccount(a: Account) {
    setNewAccountId(a.id);
    setNewAccountName_saved(a.name ?? "");
    setAccountQuery("");
    setNewFlowStep("contact");
    setNewFlowError(null);
  }

  // ── Outreach type selection ──
  function selectType(id: string) {
    setTypeId(id);
    setOutcomeId(""); // reset outcome when type changes
  }

  // ── New account/contact flow ──
  async function createAccount() {
    if (!newAccountName.trim()) {
      setNewFlowError("Account name is required.");
      return;
    }
    setNewAccountBusy(true);
    setNewFlowError(null);
    const { data, error: err } = await supabase.rpc("rpc_create_account", {
      p_name: newAccountName.trim(),
      p_account_type: newAccountType.trim() || null,
      p_notes: null,
    });
    setNewAccountBusy(false);
    if (err) { setNewFlowError(err.message); return; }
    const row = Array.isArray(data) ? data[0] : data;
    const id = String(row?.id ?? "");
    if (!id) { setNewFlowError("Account created but missing id."); return; }
    setNewAccountId(id);
    setNewAccountName_saved(newAccountName.trim());
    setNewFlowStep("contact");
  }

  async function createContact() {
    const first = newFirstName.trim();
    const last = newLastName.trim();
    if (!first || !last) { setNewFlowError("First and last name are required."); return; }
    if (!newAccountId) { setNewFlowError("Account is required."); return; }
    setNewContactBusy(true);
    setNewFlowError(null);
    const { data, error: err } = await supabase.rpc("rpc_create_contact", {
      p_account_id: newAccountId,
      p_first_name: first,
      p_last_name: last,
      p_email: newEmail.trim() || null,
      p_phone: newPhone.trim() || null,
      p_title: null,
      p_decision_role: null,
      p_priority_score: 0,
    });
    setNewContactBusy(false);
    if (err) { setNewFlowError(err.message); return; }
    const row = Array.isArray(data) ? data[0] : data;
    const id = String(row?.id ?? "");
    if (!id) { setNewFlowError("Contact created but missing id."); return; }
    // Auto-select the new contact + account
    setSelectedContactId(id);
    setSelectedContactName(`${first} ${last}`);
    setSelectedAccountId(newAccountId);
    setSelectedAccountName(accountsById.get(newAccountId)?.name ?? newAccountName_saved);
    // Reset new flow state
    setShowNewFlow(false);
    setNewAccountId("");
    setNewAccountName("");
    setNewAccountType("");
    setNewAccountName_saved("");
    setNewFirstName("");
    setNewLastName("");
    setNewEmail("");
    setNewPhone("");
    setNewFlowStep("account");
    setNewFlowError(null);
    setAccountQuery("");
    setAccountCreateMode(false);
  }

  // ── Submit ──
  async function onSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    const { data: rpcData, error: rpcErr } = await supabase.rpc(
      "rpc_log_outreach_touchpoint",
      {
        p_contact_id: selectedContactId,
        p_account_id: selectedAccountId,
        p_touchpoint_type_id: typeId,
        p_property_id: selectedPropertyId || null,
        p_outcome_id: outcomeId || null,
        p_notes: notes.trim(),
        p_happened_at: new Date().toISOString(),
        p_engagement_phase: "first_touch",
      },
    );

    if (rpcErr) {
      setError(rpcErr.message);
      setBusy(false);
      return;
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    const outreachResult: OutreachResult = {
      awarded_points: Number(row?.awarded_points ?? 0),
      outreach_count_today: Number(row?.outreach_count_today ?? 0),
      outreach_target: Number(row?.outreach_target ?? 20),
      outreach_remaining: Number(row?.outreach_remaining ?? 0),
    };

    // Follow-up scheduling
    if (followUp && selectedContactId && selectedAccountId) {
      await supabase.from("next_actions").insert({
        org_id: orgId,
        assigned_user_id: userId,
        contact_id: selectedContactId,
        account_id: selectedAccountId,
        property_id: selectedPropertyId || null,
        status: "open",
        due_at: new Date(followUpDate + "T09:00:00").toISOString(),
        notes: followUpNotes.trim() || `Follow up — ${selectedContactName}`,
        recommended_touchpoint_type_id: typeId || null,
        created_by: userId,
      });
    }

    setBusy(false);
    setResult(outreachResult);
    onSuccess(outreachResult);

    // Reset form
    setSelectedContactId("");
    setSelectedContactName("");
    setSelectedAccountId("");
    setSelectedAccountName("");
    setTypeId("");
    setOutcomeId("");
    setNotes("");
    setSelectedPropertyId("");
    setPropertyQuery("");
    setPropertyOpen(false);
    setFollowUp(false);
    setFollowUpDate(localDateValue(1));
    setFollowUpNotes("");

    // Auto-dismiss result and collapse after 2.5s
    setTimeout(() => {
      setResult(null);
      setOpen(false);
    }, 2500);
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3.5"
      >
        <div className="text-left">
          <div className="text-sm font-semibold text-slate-900">Log First Touch</div>
          <div className="text-xs text-slate-500">Grow — new outreach</div>
        </div>
        <svg
          className={["h-4 w-4 text-slate-400 transition-transform", open ? "rotate-180" : ""].join(" ")}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Success banner */}
      {result && (
        <div className="mx-4 mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-center">
          <div className="text-base font-semibold text-emerald-700">
            Logged! {result.awarded_points > 0 ? `+${result.awarded_points} pts` : ""}
          </div>
          <div className="text-xs text-emerald-600">
            {result.outreach_count_today} / {result.outreach_target} outreach today
          </div>
        </div>
      )}

      {/* Form body */}
      {open && !result && (
        <div className="space-y-4 px-4 pb-4">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* 1. Contact */}
          <div>
            <label className={sectionLabel}>Contact</label>

            {selectedContactId ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
                  <div className="min-w-0 flex-1 text-sm font-medium text-blue-900">
                    {selectedContactName}
                  </div>
                  <button
                    type="button"
                    onClick={clearContact}
                    className="shrink-0 rounded-lg p-1 text-blue-400 hover:bg-blue-100"
                    aria-label="Clear contact"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {selectedAccountName && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs text-slate-400">Account</div>
                    <div className="text-sm font-medium text-slate-700">{selectedAccountName}</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <input
                    className={input}
                    placeholder="Search by name..."
                    value={contactQuery}
                    onChange={(e) => {
                      setContactQuery(e.target.value);
                      setShowContactResults(true);
                    }}
                    onFocus={() => setShowContactResults(true)}
                  />

                  {showContactResults && contactQuery.trim().length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                      {filteredContacts.map((c) => {
                        const acct = accountsById.get(c.account_id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            className="flex w-full flex-col px-3 py-2.5 text-left hover:bg-slate-50"
                            onMouseDown={() => selectContact(c)}
                          >
                            <span className="text-sm font-medium text-slate-900">
                              {c.full_name || "Unnamed"}
                            </span>
                            <span className="text-xs text-slate-500">{acct?.name ?? ""}</span>
                          </button>
                        );
                      })}

                      {filteredContacts.length === 0 && (
                        <div className="px-3 py-2.5 text-sm text-slate-500">No contacts found.</div>
                      )}
                    </div>
                  )}
                </div>

                {!showNewFlow && (
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
                    onClick={() => {
                      setShowContactResults(false);
                      setContactQuery("");
                      setShowNewFlow(true);
                      setNewFlowStep("account");
                      setAccountCreateMode(false);
                      setAccountQuery("");
                    }}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Add new contact
                  </button>
                )}
              </div>
            )}
          </div>

          {/* New account + contact flow (inline) */}
          {showNewFlow && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              {newFlowStep === "account" ? (
                <>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Step 1 — Account
                  </div>
                  {newFlowError && (
                    <p className="text-xs text-red-600">{newFlowError}</p>
                  )}

                  {!accountCreateMode ? (
                    /* Search existing accounts */
                    <>
                      <input
                        className={input}
                        placeholder="Search accounts..."
                        value={accountQuery}
                        onChange={(e) => setAccountQuery(e.target.value)}
                        autoFocus
                      />
                      {filteredAccounts.length > 0 && (
                        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                          {filteredAccounts.map((a) => (
                            <button
                              key={a.id}
                              type="button"
                              className="block w-full px-3 py-2.5 text-left text-sm text-slate-900 hover:bg-slate-50"
                              onClick={() => selectExistingAccount(a)}
                            >
                              {a.name}
                            </button>
                          ))}
                        </div>
                      )}
                      {accountQuery.trim().length > 0 && filteredAccounts.length === 0 && (
                        <p className="text-xs text-slate-500">No accounts found.</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => { setAccountCreateMode(true); setAccountQuery(""); setNewFlowError(null); }}
                          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          + Create new account
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowNewFlow(false); setNewFlowError(null); setAccountQuery(""); }}
                          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    /* Create new account */
                    <>
                      <input
                        className={input}
                        placeholder="Company name"
                        value={newAccountName}
                        onChange={(e) => setNewAccountName(e.target.value)}
                        autoFocus
                      />
                      <select
                        className={input}
                        value={newAccountType}
                        onChange={(e) => setNewAccountType(e.target.value)}
                      >
                        <option value="">Account type (optional)</option>
                        <option value="owner">Owner</option>
                        <option value="commercial_property_management">Property Management</option>
                        <option value="facilities_management">Facilities Management</option>
                        <option value="general_contractor">General Contractor</option>
                        <option value="developer">Developer</option>
                        <option value="other">Other</option>
                      </select>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={newAccountBusy}
                          onClick={() => void createAccount()}
                          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {newAccountBusy ? "Saving..." : "Next →"}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAccountCreateMode(false); setNewAccountName(""); setNewAccountType(""); setNewFlowError(null); }}
                          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
                        >
                          ← Back
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Step 2 — Contact at {newAccountName_saved}
                  </div>
                  {newFlowError && (
                    <p className="text-xs text-red-600">{newFlowError}</p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className={input}
                      placeholder="First name"
                      value={newFirstName}
                      onChange={(e) => setNewFirstName(e.target.value)}
                    />
                    <input
                      className={input}
                      placeholder="Last name"
                      value={newLastName}
                      onChange={(e) => setNewLastName(e.target.value)}
                    />
                  </div>
                  <input
                    className={input}
                    placeholder="Email (optional)"
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                  <input
                    className={input}
                    placeholder="Phone (optional)"
                    type="tel"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={newContactBusy}
                      onClick={() => void createContact()}
                      className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {newContactBusy ? "Saving..." : "Add Contact"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowNewFlow(false); setNewFlowError(null); }}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 2. Outreach type chips */}
          <div>
            <label className={sectionLabel}>How did you reach out?</label>
            <div className="flex flex-wrap gap-2">
              {outreachTypes.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectType(t.id)}
                  className={chipBtn(typeId === t.id)}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          {/* 3. Outcome chips */}
          {typeId && filteredOutcomes.length > 0 && (
            <div>
              <label className={sectionLabel}>Outcome</label>
              <div className="flex flex-wrap gap-2">
                {filteredOutcomes.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setOutcomeId(outcomeId === o.id ? "" : o.id)}
                    className={chipBtn(outcomeId === o.id)}
                  >
                    {o.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 4. Notes */}
          <div>
            <label className={sectionLabel}>Notes</label>
            <input
              className={input}
              placeholder="What happened? (required)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* 5. Property (optional, collapsible) */}
          <div>
            <button
              type="button"
              onClick={() => setPropertyOpen(!propertyOpen)}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              <svg
                className={["h-3.5 w-3.5 transition-transform", propertyOpen ? "rotate-90" : ""].join(" ")}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              {selectedProperty ? propertyLabel(selectedProperty) : "Link a property (optional)"}
            </button>

            {propertyOpen && (
              <div className="mt-2 space-y-2">
                <input
                  className={input}
                  placeholder="Search by address..."
                  value={propertyQuery}
                  onChange={(e) => setPropertyQuery(e.target.value)}
                />
                {propertyQuery.trim().length > 0 && (
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    {filteredProperties.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setSelectedPropertyId(p.id);
                          setPropertyQuery("");
                        }}
                        className={[
                          "block w-full px-3 py-2.5 text-left text-sm hover:bg-slate-50",
                          selectedPropertyId === p.id ? "bg-blue-50 font-medium text-blue-900" : "text-slate-700",
                        ].join(" ")}
                      >
                        {propertyLabel(p)}
                      </button>
                    ))}
                    {filteredProperties.length === 0 && (
                      <div className="px-3 py-2.5 text-sm text-slate-500">No properties found.</div>
                    )}
                  </div>
                )}
                {selectedProperty && (
                  <button
                    type="button"
                    onClick={() => setSelectedPropertyId("")}
                    className="text-xs text-slate-400 hover:text-slate-600"
                  >
                    Clear property
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 6. Follow-up toggle */}
          <div>
            <button
              type="button"
              onClick={() => setFollowUp(!followUp)}
              className="flex items-center gap-3"
            >
              <div
                className={[
                  "relative h-5 w-9 rounded-full transition-colors",
                  followUp ? "bg-blue-600" : "bg-slate-200",
                ].join(" ")}
              >
                <div
                  className={[
                    "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                    followUp ? "translate-x-4" : "translate-x-0.5",
                  ].join(" ")}
                />
              </div>
              <span className="text-sm text-slate-700">Schedule follow-up</span>
            </button>

            {followUp && (
              <div className="mt-3 space-y-2">
                <input
                  type="date"
                  className={input}
                  value={followUpDate}
                  min={localDateValue(0)}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                />
                <input
                  className={input}
                  placeholder="Follow-up notes (optional)"
                  value={followUpNotes}
                  onChange={(e) => setFollowUpNotes(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Submit */}
          <button
            type="button"
            disabled={!canSubmit || busy}
            onClick={() => void onSubmit()}
            className={[
              "w-full rounded-xl py-3 text-sm font-semibold transition-colors",
              canSubmit && !busy
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-slate-100 text-slate-400",
            ].join(" ")}
          >
            {busy ? "Logging..." : "Log Outreach"}
          </button>
        </div>
      )}
    </div>
  );
}
