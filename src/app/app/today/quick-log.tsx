"use client";

// Quick Log — dead-simple, field-first interaction capture. One adaptive form that
// infers intent: the rep never chooses "search vs add" or object type.
//
//   WHO (person, match-or-create) → auto-fills their account.
//   WHAT (method defaults to Call; outcome REQUIRED when a person is present).
//   FOLLOW-UP (cadence-defaulted, one tap to adjust/clear).
//   NOTES (optional). One Save.
//
// No dead data: with a person it logs a real touchpoint; with no person it seeds a
// visibly-unworked account/property target (surfaced elsewhere until worked).
//
// Reuses EntityPicker (match-or-create), the cadence follow-up hook/fields, and the
// outcome taxonomy. Additive — the Grow/Advance flow is untouched.

import { useMemo, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import EntityPicker, { type PickerRow } from "@/app/app/_components/entity-picker";
import { getOutcomesForType } from "@/lib/constants/outcome-config";
import { useCadenceFollowUp, CadenceFollowUpFields } from "@/app/app/_components/cadence-follow-up";

type TouchpointType = { id: string; name: string; key?: string | null; is_outreach: boolean };
type Outcome = { id: string; name: string; key?: string | null; touchpoint_type_id?: string | null };

// Each smart field is either an existing pick, a to-be-created name, or empty.
type FieldState = { row: PickerRow | null; newName: string | null };
const EMPTY: FieldState = { row: null, newName: null };

function localDateLabel(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function QuickLog({
  userId,
  orgId,
  outreachTypes,
  outcomes,
  accountsById,
  onClose,
  onLogged,
}: {
  userId: string;
  orgId: string;
  outreachTypes: TouchpointType[];
  outcomes: Outcome[];
  accountsById: Map<string, { id: string; name: string | null }>;
  onClose: () => void;
  onLogged: (message: string) => void;
}) {
  const supabase = useMemo(() => createBrowserSupabase(), []);

  const [person, setPerson] = useState<FieldState>(EMPTY);
  const [account, setAccount] = useState<FieldState>(EMPTY);
  const [property, setProperty] = useState<FieldState>(EMPTY);
  // Method defaults to Call so the common case is pick-contact → tap-outcome → Save (3 taps).
  const [typeId, setTypeId] = useState(() => outreachTypes.find((t) => t.key === "call")?.id ?? "");
  const [outcomeId, setOutcomeId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fu = useCadenceFollowUp();

  const hasPerson = Boolean(person.row || person.newName);

  // Account resolved from an existing contact's account, else the account field.
  const personAccountId = (person.row?.raw?.account_id as string | undefined) ?? null;
  const resolvedAccountId = personAccountId ?? account.row?.id ?? null;
  const resolvedAccountName =
    (personAccountId ? accountsById.get(personAccountId)?.name ?? null : null) ??
    account.row?.primary ??
    account.newName ??
    null;
  // Show the account picker only when we can't auto-derive it from an existing contact.
  const showAccountPicker = !personAccountId;

  const selectedTypeKey = outreachTypes.find((t) => t.id === typeId)?.key ?? null;

  // Method-appropriate outcomes (config keys → real DB outcomes), like the Grow form.
  const methodOutcomes = useMemo(() => {
    if (!selectedTypeKey) return [] as { id: string; name: string; key: string }[];
    const cfg = getOutcomesForType(selectedTypeKey);
    const mapped = cfg
      .map((c) => {
        const db = outcomes.find((o) => o.key === c.key);
        return db ? { id: db.id, name: c.shortLabel || db.name, key: c.key } : null;
      })
      .filter((x): x is { id: string; name: string; key: string } => Boolean(x));
    return mapped.length > 0 ? mapped : outcomes.map((o) => ({ id: o.id, name: o.name, key: o.key ?? "" }));
  }, [selectedTypeKey, outcomes]);

  function selectMethod(id: string) {
    setTypeId(id);
    setOutcomeId("");
    fu.applyOutcome(null);
    setError(null);
  }

  function selectOutcome(o: { id: string; key: string }) {
    const next = outcomeId === o.id ? "" : o.id;
    setOutcomeId(next);
    fu.applyOutcome(next ? o.key : null);
    setError(null);
  }

  const methodName = outreachTypes.find((t) => t.id === typeId)?.name ?? "Touch";
  const outcomeName = methodOutcomes.find((o) => o.id === outcomeId)?.name ?? "";

  async function onSave() {
    setError(null);
    setBusy(true);
    try {
      // 1) Resolve account id (existing contact's account → account pick → new account).
      let accountId: string | null = personAccountId ?? account.row?.id ?? null;
      if (!accountId && account.newName) {
        const { data, error: e } = await supabase.rpc("rpc_create_account", {
          p_name: account.newName,
          p_account_type: null,
          p_notes: null,
        });
        if (e) throw new Error(e.message);
        const r = Array.isArray(data) ? data[0] : data;
        accountId = (r?.id as string) ?? null;
      }

      // 2) Resolve contact id (person).
      let contactId: string | null = person.row?.id ?? null;
      let contactName: string | null = person.row?.primary ?? null;
      if (!contactId && person.newName) {
        const parts = person.newName.trim().split(/\s+/);
        if (parts.length < 2) throw new Error("Add a first and last name (e.g. “Sarah Johnson”).");
        if (!accountId) throw new Error("Pick or add an account for the new person.");
        const first = parts[0];
        const last = parts.slice(1).join(" ");
        const { data, error: e } = await supabase.rpc("rpc_create_contact", {
          p_account_id: accountId,
          p_first_name: first,
          p_last_name: last,
          p_title: null,
          p_email: null,
          p_phone: null,
          p_decision_role: null,
          p_priority_score: 0,
        });
        if (e) throw new Error(e.message);
        const r = Array.isArray(data) ? data[0] : data;
        contactId = (r?.id as string) ?? null;
        contactName = person.newName.trim();
      }

      // 3) Resolve property (optional).
      let propertyId: string | null = property.row?.id ?? null;
      if (!propertyId && property.newName) {
        if (!accountId) throw new Error("A property needs an account.");
        const { data, error: e } = await supabase.rpc("rpc_quick_add_property", {
          p_account_id: accountId,
          p_address_line1: property.newName.trim(),
        });
        if (e) throw new Error(e.message);
        propertyId = ((data as { id?: string } | null)?.id as string) ?? null;
      }

      // 4) Branch: person present → log a real touchpoint; else → seed an unworked target.
      if (contactId) {
        if (!accountId) throw new Error("This contact is missing an account.");
        if (!typeId) throw new Error("Pick how you reached out.");
        if (!outcomeId) throw new Error("Pick an outcome — no dead interactions.");
        const { data, error: e } = await supabase.rpc("rpc_log_outreach_touchpoint", {
          p_contact_id: contactId,
          p_account_id: accountId,
          p_touchpoint_type_id: typeId,
          p_property_id: propertyId,
          p_outcome_id: outcomeId,
          p_notes: notes.trim() || `${methodName} · ${outcomeName}`,
          // engagement_phase is derived server-side.
        });
        if (e) throw new Error(e.message);
        const row = Array.isArray(data) ? data[0] : data;
        const tpId = (row?.touchpoint_id as string | undefined) ?? null;

        const followUpRow = fu.buildInsert({
          orgId,
          userId,
          contactId,
          accountId,
          propertyId,
          typeId,
          touchpointId: tpId,
          fallbackNote: contactName ? `Follow up — ${contactName}` : "Follow up",
        });
        // followUpRow is null only when the rep genuinely wants no follow-up
        // (toggle off, or a terminal outcome). When they DID want one, never
        // report "no follow-up" on a save failure — that hid real data loss.
        let followMsg = "no follow-up";
        if (followUpRow) {
          const { error: naErr } = await supabase.from("next_actions").insert(followUpRow);
          if (naErr) {
            // The touchpoint is already saved (immutable); surface the follow-up
            // failure instead of swallowing it so the rep can re-add it.
            console.error("Quick Log: next_actions insert failed:", naErr.message);
            followMsg = "follow-up didn't save — re-add from the contact";
          } else {
            followMsg = `next touch ${localDateLabel(fu.date)}`;
          }
        }
        onLogged(`Logged · ${followMsg}`);
      } else {
        // No person — a seeded target. Requires something newly created to seed.
        if (!account.newName && !property.newName) {
          throw new Error("Add a person to log an interaction, or add a new account/property to seed a target.");
        }
        const what = property.newName ? "Property" : "Account";
        onLogged(`${what} added${resolvedAccountName ? `: ${resolvedAccountName}` : ""} · needs first contact`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-xl border border-slate-400 bg-white px-3 py-3 text-base text-slate-900 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
  const chip = (active: boolean) =>
    [
      "rounded-xl border px-3 py-3 text-base font-medium transition-colors",
      active ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
    ].join(" ");

  const canSave = hasPerson ? Boolean(outcomeId) : Boolean(account.newName || property.newName);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-log-title"
        className="flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-md sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 id="quick-log-title" className="text-lg font-semibold text-slate-900">Quick Log</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.28 3.22a.75.75 0 00-1.06 1.06L8.94 10l-5.72 5.72a.75.75 0 101.06 1.06L10 11.06l5.72 5.72a.75.75 0 101.06-1.06L11.06 10l5.72-5.72a.75.75 0 00-1.06-1.06L10 8.94 4.28 3.22z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* WHO */}
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Person</label>
            <EntityPicker
              kind="contact"
              strongBorder
              value={person.row?.id ?? ""}
              autoFocus
              initialSelected={person.row ? { id: person.row.id, primary: person.row.primary, secondary: person.row.secondary } : null}
              onChange={(row) => {
                setPerson({ row, newName: null });
                setError(null);
              }}
              onCreateNew={(name) => {
                setPerson({ row: null, newName: name });
                setError(null);
              }}
              placeholder="Search a person by name…"
            />
            {personAccountId && (
              <p className="mt-1.5 text-xs text-slate-500">
                Account: <span className="font-medium text-slate-700">{resolvedAccountName ?? "—"}</span>
                <span className="text-slate-400"> · auto-filled</span>
              </p>
            )}
          </div>

          {/* ACCOUNT (only when not auto-derived from an existing contact) */}
          {showAccountPicker && (
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Account</label>
              <EntityPicker
                kind="account"
                strongBorder
                value={account.row?.id ?? ""}
                initialSelected={account.row ? { id: account.row.id, primary: account.row.primary, secondary: account.row.secondary } : null}
                onChange={(row) => {
                  setAccount({ row, newName: null });
                  setError(null);
                }}
                onCreateNew={(name) => {
                  setAccount({ row: null, newName: name });
                  setError(null);
                }}
                placeholder="Search an account…"
              />
            </div>
          )}

          {/* PROPERTY (optional) */}
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">
              Property <span className="font-normal text-slate-400">· optional</span>
            </label>
            <EntityPicker
              kind="property"
              value={property.row?.id ?? ""}
              accountId={resolvedAccountId}
              initialSelected={property.row ? { id: property.row.id, primary: property.row.primary, secondary: property.row.secondary } : null}
              onChange={(row) => {
                setProperty({ row, newName: null });
                setError(null);
              }}
              onCreateNew={(name) => {
                setProperty({ row: null, newName: name });
                setError(null);
              }}
              placeholder="Search a property…"
            />
          </div>

          {/* WHAT — method */}
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">How</label>
            <div className="grid grid-cols-3 gap-2">
              {outreachTypes.map((t) => (
                <button key={t.id} type="button" onClick={() => selectMethod(t.id)} className={chip(typeId === t.id)}>
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          {/* WHAT — outcome (required when a person is present) */}
          {typeId && methodOutcomes.length > 0 && (
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                Outcome {hasPerson && <span className="text-red-600">*</span>}
              </label>
              <div className="flex flex-wrap gap-2">
                {methodOutcomes.map((o) => (
                  <button key={o.id} type="button" onClick={() => selectOutcome(o)} className={chip(outcomeId === o.id)}>
                    {o.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* FOLLOW-UP (cadence-defaulted) — only when logging an interaction */}
          {hasPerson && (
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Follow-up</label>
              <CadenceFollowUpFields fu={fu} />
            </div>
          )}

          {/* NOTES */}
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">
              Notes <span className="font-normal text-slate-400">· optional</span>
            </label>
            <input className={field} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="One line…" />
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          {!hasPerson && (
            <p className="text-xs text-slate-500">
              No person selected — this saves a new account/property as a target that will nag until it gets a first contact.
            </p>
          )}
        </div>

        {/* Save */}
        <div className="border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            disabled={busy || !canSave}
            onClick={() => void onSave()}
            className={[
              "w-full rounded-xl px-4 py-3.5 text-base font-semibold transition-colors",
              busy || !canSave ? "bg-slate-100 text-slate-400" : "bg-blue-600 text-white hover:bg-blue-700",
            ].join(" ")}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
