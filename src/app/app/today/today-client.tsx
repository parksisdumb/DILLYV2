
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

type Tab = "grow" | "advance";
type Message = { tone: "success" | "error"; text: string } | null;

type Account = { id: string; name: string | null };
type Contact = { id: string; full_name: string | null; account_id: string };
type Property = { id: string; address_line1: string; city: string | null; state: string | null };
type TouchpointType = {
  id: string;
  name: string;
  key?: string | null;
  is_outreach: boolean;
};
type Outcome = { id: string; name: string; touchpoint_type_id?: string | null };

type NextAction = {
  id: string;
  property_id: string;
  contact_id: string | null;
  account_id: string | null;
  opportunity_id: string | null;
  due_at: string;
  notes: string | null;
  recommended_touchpoint_type_id: string | null;
};

type DashboardRow = {
  points_today: number;
  outreach_today: number;
  outreach_target: number;
  outreach_remaining: number;
  next_actions_due_today: number;
  next_actions_overdue: number;
  streak: number;
};

const label = "text-sm font-medium text-slate-700";
const input = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900";
const notesInput =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 min-h-[80px]";
const card = "rounded-xl border border-slate-200 bg-white shadow-sm p-4";
const chipBase = "rounded-full px-2 py-1 text-xs font-medium";
const buttonPrimary =
  "rounded-md bg-indigo-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700";
const buttonMuted =
  "rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50";

const localDateTime = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const plusDaysIso = (iso: string, days: number) => {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

const toNumber = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const OUTREACH_TYPE_KEYS = new Set(["call", "email", "text", "door_knock", "site_visit"]);

export default function TodayClient({ userId }: { userId: string }) {
  const supabase = useMemo(() => createBrowserSupabase(), []);

  const [tab, setTab] = useState<Tab>("grow");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [toast, setToast] = useState<Message>(null);
  const [error, setError] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [touchpointTypes, setTouchpointTypes] = useState<TouchpointType[]>([]);
  const [touchpointOutcomes, setTouchpointOutcomes] = useState<Outcome[]>([]);
  const [nextActions, setNextActions] = useState<NextAction[]>([]);
  const [completeAction, setCompleteAction] = useState<NextAction | null>(null);
  const [assignContactAction, setAssignContactAction] = useState<NextAction | null>(null);
  const [assignContactQuery, setAssignContactQuery] = useState("");
  const [assignContactId, setAssignContactId] = useState("");

  const [dashboard, setDashboard] = useState<DashboardRow>({
    points_today: 0,
    outreach_today: 0,
    outreach_target: 20,
    outreach_remaining: 20,
    next_actions_due_today: 0,
    next_actions_overdue: 0,
    streak: 0,
  });

  const [outreachTypeId, setOutreachTypeId] = useState("");
  const [outreachOutcomeId, setOutreachOutcomeId] = useState("");
  const [outreachNotes, setOutreachNotes] = useState("");

  const [accountQuery, setAccountQuery] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("");

  const [selectedContactId, setSelectedContactId] = useState("");

  const [propertyQuery, setPropertyQuery] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState("");

  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountType, setNewAccountType] = useState("");

  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [newContactFirstName, setNewContactFirstName] = useState("");
  const [newContactLastName, setNewContactLastName] = useState("");
  const [newContactTitle, setNewContactTitle] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactDecisionRole, setNewContactDecisionRole] = useState("");
  const [contactDedupeNotice, setContactDedupeNotice] = useState<string | null>(null);
  const [contactMismatchPrompt, setContactMismatchPrompt] = useState<{
    contactId: string;
    accountId: string;
    accountLabel: string;
    message: string;
  } | null>(null);

  const [propertyModalOpen, setPropertyModalOpen] = useState(false);
  const [newPropertyAddressLine1, setNewPropertyAddressLine1] = useState("");
  const [newPropertyAddressLine2, setNewPropertyAddressLine2] = useState("");
  const [newPropertyCity, setNewPropertyCity] = useState("");
  const [newPropertyState, setNewPropertyState] = useState("");
  const [newPropertyPostalCode, setNewPropertyPostalCode] = useState("");
  const [newPropertyCountry, setNewPropertyCountry] = useState("US");

  const outreachTypes = useMemo(
    () => touchpointTypes.filter((t) => t.is_outreach),
    [touchpointTypes],
  );

  const filteredOutcomes = useMemo(() => {
    if (!outreachTypeId) return touchpointOutcomes;

    const typeSpecific = touchpointOutcomes.filter(
      (o) => o.touchpoint_type_id && o.touchpoint_type_id === outreachTypeId,
    );

    return typeSpecific.length > 0 ? typeSpecific : touchpointOutcomes;
  }, [outreachTypeId, touchpointOutcomes]);

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const contactsById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const propertiesById = useMemo(() => new Map(properties.map((p) => [p.id, p])), [properties]);

  const selectedAccount = selectedAccountId ? accountsById.get(selectedAccountId) ?? null : null;
  const selectedContact = selectedContactId ? contactsById.get(selectedContactId) ?? null : null;
  const selectedProperty = selectedPropertyId ? propertiesById.get(selectedPropertyId) ?? null : null;

  const filteredAccounts = useMemo(() => {
    const q = accountQuery.trim().toLowerCase();
    if (!q) return accounts.slice(0, 8);
    return accounts
      .filter((a) => (a.name || "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [accounts, accountQuery]);

  const filteredProperties = useMemo(() => {
    const q = propertyQuery.trim().toLowerCase();
    if (!q) return properties.slice(0, 8);
    return properties
      .filter((p) =>
        [p.address_line1, p.city, p.state]
          .filter(Boolean)
          .join(", ")
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 8);
  }, [properties, propertyQuery]);

  const filteredAssignContacts = useMemo(() => {
    if (!assignContactAction) return [];
    const q = assignContactQuery.trim().toLowerCase();
    const rows = contacts.filter((c) => (c.full_name || "").toLowerCase().includes(q));
    const prioritized = rows.sort((a, b) => {
      const aScore =
        a.account_id === assignContactAction.account_id ||
        a.account_id === (assignContactAction.contact_id ? contactsById.get(assignContactAction.contact_id)?.account_id : null)
          ? 1
          : 0;
      const bScore =
        b.account_id === assignContactAction.account_id ||
        b.account_id === (assignContactAction.contact_id ? contactsById.get(assignContactAction.contact_id)?.account_id : null)
          ? 1
          : 0;
      return bScore - aScore;
    });
    return prioritized.slice(0, 20);
  }, [assignContactAction, assignContactQuery, contacts, contactsById]);

  const labelProperty = (propertyId: string) => {
    const p = propertiesById.get(propertyId);
    if (!p) return "Unknown property";
    return [p.address_line1, p.city, p.state].filter(Boolean).join(", ");
  };

  const labelAccount = (accountId: string | null) => {
    if (!accountId) return "No account selected";
    return accountsById.get(accountId)?.name || "Unknown account";
  };

  const canSubmitOutreach =
    outreachTypeId.length > 0 &&
    outreachNotes.trim().length > 0 &&
    selectedAccountId.length > 0 &&
    selectedContactId.length > 0;
  const accountSearchActive = accountQuery.trim().length > 0;
  const propertySearchActive = propertyQuery.trim().length > 0;
  const outreachRemaining = toNumber(dashboard.outreach_remaining, 0);
  const outreachComplete = outreachRemaining <= 0;

  const showToast = useCallback((tone: "success" | "error", text: string) => {
    setToast({ tone, text });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 2500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: me, error: meError } = await supabase
        .from("org_users")
        .select("org_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (meError) throw new Error(meError.message);
      if (!me?.org_id) throw new Error("No org membership found.");

      const [a, c, p, to, na, dash] = await Promise.all([
        supabase.from("accounts").select("id,name").eq("org_id", me.org_id).is("deleted_at", null),
        supabase
          .from("contacts")
          .select("id,full_name,account_id")
          .eq("org_id", me.org_id)
          .is("deleted_at", null),
        supabase
          .from("properties")
          .select("id,address_line1,city,state")
          .eq("org_id", me.org_id)
          .is("deleted_at", null),
        supabase
          .from("touchpoint_outcomes")
          .select("id,name,touchpoint_type_id")
          .eq("org_id", me.org_id)
          .order("sort_order"),
        supabase
          .from("next_actions")
          .select(
            "id,property_id,contact_id,account_id,opportunity_id,due_at,notes,recommended_touchpoint_type_id",
          )
          .eq("assigned_user_id", userId)
          .eq("status", "open")
          .order("due_at"),
        supabase.rpc("rpc_today_dashboard"),
      ]);

      const firstError = [a.error, c.error, p.error, to.error, na.error, dash.error].find(Boolean);
      if (firstError) throw new Error(firstError.message);

      const ttWithOutreach = await supabase
        .from("touchpoint_types")
        .select("id,name,key,is_outreach")
        .eq("org_id", me.org_id)
        .order("sort_order");

      let resolvedTouchpointTypes: TouchpointType[] = [];
      if (ttWithOutreach.error) {
        const msg = ttWithOutreach.error.message.toLowerCase();
        if (ttWithOutreach.error.code === "42703" || msg.includes("is_outreach")) {
          const ttFallback = await supabase
            .from("touchpoint_types")
            .select("id,name,key")
            .eq("org_id", me.org_id)
            .order("sort_order");

          if (ttFallback.error) throw new Error(ttFallback.error.message);

          resolvedTouchpointTypes = ((ttFallback.data ?? []) as TouchpointType[]).map((tt) => ({
            id: tt.id,
            name: tt.name,
            key: tt.key ?? null,
            is_outreach: OUTREACH_TYPE_KEYS.has((tt.key ?? "").toLowerCase()),
          }));
        } else {
          throw new Error(ttWithOutreach.error.message);
        }
      } else {
        resolvedTouchpointTypes = ((ttWithOutreach.data ?? []) as TouchpointType[]).map((tt) => ({
          id: tt.id,
          name: tt.name,
          key: tt.key ?? null,
          is_outreach: Boolean(tt.is_outreach),
        }));
      }

      setAccounts((a.data ?? []) as Account[]);
      setContacts((c.data ?? []) as Contact[]);
      setProperties((p.data ?? []) as Property[]);
      setTouchpointTypes(resolvedTouchpointTypes);
      setTouchpointOutcomes((to.data ?? []) as Outcome[]);
      setNextActions((na.data ?? []) as NextAction[]);

      const dashRow = Array.isArray(dash.data)
        ? ((dash.data[0] as Partial<DashboardRow> | undefined) ?? undefined)
        : undefined;

      setDashboard({
        points_today: toNumber(dashRow?.points_today, 0),
        outreach_today: toNumber(dashRow?.outreach_today, 0),
        outreach_target: toNumber(dashRow?.outreach_target, 20),
        outreach_remaining: toNumber(dashRow?.outreach_remaining, 20),
        next_actions_due_today: toNumber(dashRow?.next_actions_due_today, 0),
        next_actions_overdue: toNumber(dashRow?.next_actions_overdue, 0),
        streak: toNumber(dashRow?.streak, 0),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (outreachOutcomeId && !filteredOutcomes.some((o) => o.id === outreachOutcomeId)) {
      setOutreachOutcomeId("");
    }
  }, [filteredOutcomes, outreachOutcomeId]);

  async function callRpc(
    key: string,
    rpc: string,
    params: Record<string, unknown>,
    success: string,
  ) {
    setBusy(key);
    setMessage(null);

    const { error: rpcError } = await supabase.rpc(rpc, params);

    setBusy(null);
    if (rpcError) {
      setMessage({ tone: "error", text: rpcError.message });
      showToast("error", rpcError.message);
      return false;
    }

    setMessage({ tone: "success", text: success });
    showToast("success", success);
    await load();
    return true;
  }

  async function onSnooze(action: NextAction) {
    setBusy(`snooze-${action.id}`);
    setMessage(null);

    const { error: upError } = await supabase
      .from("next_actions")
      .update({ due_at: plusDaysIso(action.due_at, 2) })
      .eq("id", action.id)
      .eq("assigned_user_id", userId)
      .eq("status", "open");

    setBusy(null);
    if (upError) {
      setMessage({ tone: "error", text: upError.message });
      showToast("error", upError.message);
      return;
    }

    const okMessage = "Next action snoozed by 2 days.";
    setMessage({ tone: "success", text: okMessage });
    showToast("success", okMessage);
    await load();
  }

  function onOpenAssignContact(action: NextAction) {
    setAssignContactAction(action);
    setAssignContactQuery("");
    setAssignContactId(action.contact_id || "");
  }

  async function onSaveAssignContact() {
    if (!assignContactAction) return;
    if (!assignContactId) {
      const msg = "Select a contact.";
      setMessage({ tone: "error", text: msg });
      showToast("error", msg);
      return;
    }

    const selected = contactsById.get(assignContactId);
    if (!selected) {
      const msg = "Selected contact not found.";
      setMessage({ tone: "error", text: msg });
      showToast("error", msg);
      return;
    }

    setBusy(`assign-contact-${assignContactAction.id}`);
    setMessage(null);

    const { error: upError } = await supabase
      .from("next_actions")
      .update({
        contact_id: assignContactId,
        account_id: selected.account_id || null,
      })
      .eq("id", assignContactAction.id)
      .eq("assigned_user_id", userId)
      .eq("status", "open");

    setBusy(null);
    if (upError) {
      setMessage({ tone: "error", text: upError.message });
      showToast("error", upError.message);
      return;
    }

    setAssignContactAction(null);
    setAssignContactId("");
    setAssignContactQuery("");
    const okMessage = "Contact assigned to next action.";
    setMessage({ tone: "success", text: okMessage });
    showToast("success", okMessage);
    await load();
  }

  async function onCompleteAction(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!completeAction) return;

    const fd = new FormData(e.currentTarget);
    const contactId = String(fd.get("contact_id") || "");
    const explicitAccountId = String(fd.get("account_id") || "");
    const derivedAccountId =
      explicitAccountId || (contactId ? contactsById.get(contactId)?.account_id || "" : "");

    const ok = await callRpc(
      `complete-${completeAction.id}`,
      "rpc_log_touchpoint",
      {
        p_property_id: completeAction.property_id,
        p_account_id: derivedAccountId || null,
        p_contact_id: contactId || null,
        p_opportunity_id: completeAction.opportunity_id || null,
        p_touchpoint_type_id: fd.get("touchpoint_type_id"),
        p_outcome_id: fd.get("outcome_id") || null,
        p_happened_at: new Date(String(fd.get("happened_at") || localDateTime())).toISOString(),
        p_notes: fd.get("notes") || null,
        p_rep_user_id: userId,
        p_complete_next_action_id: completeAction.id,
        p_engagement_phase: "follow_up",
      },
      "Touchpoint logged and action completed.",
    );

    if (ok) setCompleteAction(null);
  }

  async function onCreateAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const name = newAccountName.trim();
    if (!name) {
      const msg = "Account name is required.";
      setMessage({ tone: "error", text: msg });
      showToast("error", msg);
      return;
    }

    setBusy("create-account");
    setMessage(null);

    const { data, error: rpcError } = await supabase.rpc("rpc_create_account", {
      p_name: name,
      p_account_type: newAccountType.trim() || null,
      p_notes: null,
    });

    setBusy(null);
    if (rpcError) {
      setMessage({ tone: "error", text: rpcError.message });
      showToast("error", rpcError.message);
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    const accountId = String(row?.id ?? "");
    if (!accountId) {
      const msg = "Account created, but response was missing id.";
      setMessage({ tone: "error", text: msg });
      showToast("error", msg);
      return;
    }

    setSelectedAccountId(accountId);
    setSelectedContactId("");
    setAccountModalOpen(false);
    setNewAccountName("");
    setNewAccountType("");

    const okMessage = "Account created.";
    setMessage({ tone: "success", text: okMessage });
    showToast("success", okMessage);
    await load();
  }

  async function onCreateContact(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!selectedAccountId) {
      const msg = "Select or create an account first.";
      setMessage({ tone: "error", text: msg });
      showToast("error", msg);
      return;
    }

    const first = newContactFirstName.trim();
    const last = newContactLastName.trim();
    if (!first || !last) {
      const msg = "First name and last name are required.";
      setMessage({ tone: "error", text: msg });
      showToast("error", msg);
      return;
    }

    setBusy("create-contact");
    setMessage(null);
    setContactMismatchPrompt(null);

    const { data, error: rpcError } = await supabase.rpc("rpc_create_contact", {
      p_account_id: selectedAccountId,
      p_first_name: first,
      p_last_name: last,
      p_title: newContactTitle.trim() || null,
      p_email: newContactEmail.trim() || null,
      p_phone: newContactPhone.trim() || null,
      p_decision_role: newContactDecisionRole.trim() || null,
      p_priority_score: 0,
    });

    setBusy(null);
    if (rpcError) {
      setMessage({ tone: "error", text: rpcError.message });
      showToast("error", rpcError.message);
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    const contactId = String(row?.id ?? "");
    const contactAccountId = String(row?.account_id ?? "");
    const deduped = Boolean(row?.deduped);
    const dedupeReason = String(row?.dedupe_reason ?? "");
    const warning = String(row?.warning ?? "");
    const warningAccountMismatch = Boolean(row?.warning_account_mismatch);
    const dedupeMethod =
      dedupeReason === "email" || dedupeReason === "phone" ? dedupeReason : "email/phone";
    if (!contactId) {
      const msg = "Contact created, but response was missing id.";
      setMessage({ tone: "error", text: msg });
      showToast("error", msg);
      return;
    }

    if (deduped) {
      setContactDedupeNotice(`Existing contact found by ${dedupeMethod} - using existing record.`);
    } else {
      setContactDedupeNotice(null);
    }

    if (warningAccountMismatch && contactAccountId && contactAccountId !== selectedAccountId) {
      const accountLabel =
        accountsById.get(contactAccountId)?.name || `Account ${contactAccountId.slice(0, 8)}...`;
      setContactMismatchPrompt({
        contactId,
        accountId: contactAccountId,
        accountLabel,
        message:
          warning ||
          `This contact already belongs to ${accountLabel}. Switch selected account to ${accountLabel}?`,
      });
      return;
    }

    setSelectedContactId(contactId);
    setContactModalOpen(false);
    setNewContactFirstName("");
    setNewContactLastName("");
    setNewContactTitle("");
    setNewContactEmail("");
    setNewContactPhone("");
    setNewContactDecisionRole("");

    const okMessage =
      deduped && dedupeReason
        ? `Existing contact reused by ${dedupeReason}.`
        : "Contact added.";
    setMessage({ tone: "success", text: okMessage });
    showToast("success", okMessage);
    await load();
  }

  async function onSwitchToExistingContactAccount() {
    if (!contactMismatchPrompt) return;

    setSelectedAccountId(contactMismatchPrompt.accountId);
    setSelectedContactId(contactMismatchPrompt.contactId);
    setContactMismatchPrompt(null);
    setContactModalOpen(false);
    setNewContactFirstName("");
    setNewContactLastName("");
    setNewContactTitle("");
    setNewContactEmail("");
    setNewContactPhone("");
    setNewContactDecisionRole("");

    const okMessage = `Switched to ${contactMismatchPrompt.accountLabel} and selected existing contact.`;
    setMessage({ tone: "success", text: okMessage });
    showToast("success", okMessage);
    await load();
  }

  async function onCreateProperty(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const address1 = newPropertyAddressLine1.trim();
    const city = newPropertyCity.trim();
    const state = newPropertyState.trim();
    const postal = newPropertyPostalCode.trim();
    if (!address1 || !city || !state || !postal) {
      const msg = "Address line 1, city, state, and postal code are required.";
      setMessage({ tone: "error", text: msg });
      showToast("error", msg);
      return;
    }

    setBusy("create-property");
    setMessage(null);

    const propertyPayload = {
      p_address_line1: address1,
      p_address_line2: newPropertyAddressLine2.trim() || null,
      p_city: city,
      p_state: state,
      p_postal_code: postal,
      p_country: newPropertyCountry.trim() || "US",
      p_notes: null,
    };

    const { data, error: rpcError } = selectedAccountId
      ? await supabase.rpc("rpc_quick_add_property", {
          p_account_id: selectedAccountId,
          ...propertyPayload,
          p_relationship_type: "property_manager",
          p_is_primary: true,
        })
      : await supabase.rpc("rpc_create_property", propertyPayload);

    setBusy(null);
    if (rpcError) {
      setMessage({ tone: "error", text: rpcError.message });
      showToast("error", rpcError.message);
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    const propertyId = String(row?.id ?? "");
    if (!propertyId) {
      const msg = "Property created, but response was missing id.";
      setMessage({ tone: "error", text: msg });
      showToast("error", msg);
      return;
    }

    setSelectedPropertyId(propertyId);
    setPropertyModalOpen(false);
    setNewPropertyAddressLine1("");
    setNewPropertyAddressLine2("");
    setNewPropertyCity("");
    setNewPropertyState("");
    setNewPropertyPostalCode("");
    setNewPropertyCountry("US");

    const okMessage = "Property created.";
    setMessage({ tone: "success", text: okMessage });
    showToast("success", okMessage);
    await load();
  }

  async function onSubmitOutreach(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!canSubmitOutreach) {
      const msg =
        "Select outreach type, add notes, select account, and add contact before submitting.";
      setMessage({ tone: "error", text: msg });
      showToast("error", msg);
      return;
    }

    const ok = await callRpc(
      "outreach-submit",
      "rpc_log_outreach_touchpoint",
      {
        p_touchpoint_type_id: outreachTypeId,
        p_outcome_id: outreachOutcomeId || null,
        p_happened_at: new Date().toISOString(),
        p_notes: outreachNotes.trim(),
        p_contact_id: selectedContactId,
        p_account_id: selectedAccountId,
        p_property_id: selectedPropertyId || null,
        p_engagement_phase: "first_touch",
      },
      "Outreach logged successfully.",
    );

    if (ok) {
      setOutreachTypeId("");
      setOutreachNotes("");
      setOutreachOutcomeId("");
      setSelectedAccountId("");
      setSelectedContactId("");
      setSelectedPropertyId("");
      setAccountQuery("");
      setPropertyQuery("");
    }
  }

  if (loading) return <p className="text-sm text-slate-600">Loading Today...</p>;
  if (error)
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {error}
      </div>
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Today</h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className={card}>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Points Today</div>
            <span className={`${chipBase} bg-indigo-100 text-indigo-700`}>Live</span>
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{dashboard.points_today}</div>
        </div>
        <div className={card}>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Outreach</div>
            <span
              className={`${chipBase} ${
                outreachComplete
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {outreachComplete ? "Complete" : "In Progress"}
            </span>
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">
            {dashboard.outreach_today} / {dashboard.outreach_target}
          </div>
          <div className="text-xs text-slate-600">Remaining: {dashboard.outreach_remaining}</div>
        </div>
        <div className={card}>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Next Actions Due</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{dashboard.next_actions_due_today}</div>
        </div>
        <div className={card}>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Overdue</div>
            <span className={`${chipBase} bg-rose-100 text-rose-700`}>Attention</span>
          </div>
          <div className="mt-1 text-2xl font-semibold text-rose-700">{dashboard.next_actions_overdue}</div>
        </div>
        <div className={card}>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Streak</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{dashboard.streak}</div>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          className={`${buttonMuted} ${tab === "grow" ? "bg-indigo-600 border-indigo-600 text-white" : ""}`}
          onClick={() => setTab("grow")}
        >
          Grow
        </button>
        <button
          className={`${buttonMuted} ${tab === "advance" ? "bg-indigo-600 border-indigo-600 text-white" : ""}`}
          onClick={() => setTab("advance")}
        >
          Advance
        </button>
      </div>

      {message && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            message.tone === "success"
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </div>
      )}

      {tab === "grow" && (
        <div className={card}>
          <div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Log First-Touch Outreach</h2>
              <p className="text-sm text-slate-600">
                New contact required. Account required. Property optional.
              </p>
            </div>
          </div>

          <form className="mt-3 space-y-3" onSubmit={(e) => void onSubmitOutreach(e)}>
            <div className="space-y-1">
              <label className={label}>Outreach type</label>
              <select
                value={outreachTypeId}
                onChange={(e) => setOutreachTypeId(e.target.value)}
                className={input}
                required
              >
                <option value="">Select outreach type</option>
                {outreachTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className={label}>Outcome (optional)</label>
              <select
                value={outreachOutcomeId}
                onChange={(e) => setOutreachOutcomeId(e.target.value)}
                className={input}
              >
                <option value="">No outcome</option>
                {filteredOutcomes.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className={label}>Notes</label>
              <textarea
                value={outreachNotes}
                onChange={(e) => setOutreachNotes(e.target.value)}
                className={notesInput}
                placeholder="Required notes"
                required
              />
            </div>

            <div className={card}>
              <div className="flex items-center justify-between gap-2">
                <label className={label}>Account</label>
                <button
                  type="button"
                  className={buttonMuted}
                  onClick={() => setAccountModalOpen(true)}
                >
                  New Account
                </button>
              </div>

              <input
                value={accountQuery}
                onChange={(e) => setAccountQuery(e.target.value)}
                className={input}
                placeholder="Search accounts..."
              />

              {accountSearchActive ? (
                <div className="max-h-56 space-y-2 overflow-auto">
                  {filteredAccounts.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={`w-full rounded-md border px-2.5 py-1.5 text-left text-sm ${
                        selectedAccountId === a.id
                          ? "border-slate-900 bg-slate-50 text-slate-900"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                      onClick={() => {
                        setSelectedAccountId(a.id);
                        setSelectedContactId("");
                        setContactDedupeNotice(null);
                      }}
                    >
                      {a.name || "Unnamed account"}
                    </button>
                  ))}
                  {filteredAccounts.length === 0 && (
                    <p className="text-sm text-slate-500">No accounts found.</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500">Start typing to search accounts.</p>
              )}

              {selectedAccount && (
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                  <span>Selected: {selectedAccount.name || "Unnamed account"}</span>
                </div>
              )}
            </div>

            <div className={card}>
              <div className="flex items-center justify-between gap-2">
                <label className={label}>Contact (new only)</label>
                <button
                  type="button"
                  className={buttonMuted}
                  onClick={() => {
                    if (!selectedAccountId) {
                      const msg = "Select or create an account first.";
                      setMessage({ tone: "error", text: msg });
                      showToast("error", msg);
                      return;
                    }
                    setContactMismatchPrompt(null);
                    setContactModalOpen(true);
                  }}
                >
                  Add Contact
                </button>
              </div>
              {contactDedupeNotice && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  {contactDedupeNotice}
                </p>
              )}

              {!selectedContact ? (
                <p className="text-sm text-slate-500">No contact selected yet.</p>
              ) : (
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                  <span>Selected: {selectedContact.full_name || "Unnamed contact"}</span>
                </div>
              )}
            </div>

            <div className={card}>
              <div className="flex items-center justify-between gap-2">
                <label className={label}>Property (optional)</label>
                <button type="button" className={buttonMuted} onClick={() => setPropertyModalOpen(true)}>
                  New Property
                </button>
              </div>

              <input
                value={propertyQuery}
                onChange={(e) => setPropertyQuery(e.target.value)}
                className={input}
                placeholder="Search properties by address..."
              />

              {propertySearchActive ? (
                <div className="max-h-56 space-y-2 overflow-auto">
                  {filteredProperties.map((property) => (
                    <button
                      key={property.id}
                      type="button"
                      className={`w-full rounded-md border px-2.5 py-1.5 text-left text-sm ${
                        selectedPropertyId === property.id
                          ? "border-slate-900 bg-slate-50 text-slate-900"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                      onClick={() => setSelectedPropertyId(property.id)}
                    >
                      {labelProperty(property.id)}
                    </button>
                  ))}
                  {filteredProperties.length === 0 && (
                    <p className="text-sm text-slate-500">No properties found.</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500">Start typing to search properties.</p>
              )}

              {selectedProperty ? (
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                  <span>Selected: {labelProperty(selectedProperty.id)}</span>
                  <button
                    type="button"
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                    onClick={() => setSelectedPropertyId("")}
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <p className="text-xs text-slate-500">No property selected.</p>
              )}
            </div>

            <button
              type="submit"
              className={buttonPrimary}
              disabled={busy === "outreach-submit" || !canSubmitOutreach}
            >
              {busy === "outreach-submit" ? "Saving..." : "Save Outreach"}
            </button>
          </form>
        </div>
      )}

      {tab === "advance" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Next Actions</h2>
            <p className="text-sm text-slate-600">Due today and overdue work from your queue.</p>
          </div>

          {nextActions.length === 0 ? (
            <p className="text-sm text-slate-600">No open next actions.</p>
          ) : (
            <div className="space-y-3">
              {nextActions.map((action) => {
                const due = new Date(action.due_at);
                const now = new Date();
                const startOfToday = new Date(now);
                startOfToday.setHours(0, 0, 0, 0);
                const isOverdue = due < startOfToday;
                const isDueToday = due >= startOfToday && due < plusDayStart(startOfToday);
                const actionContact = action.contact_id ? contactsById.get(action.contact_id) : null;
                const actionAccountId = actionContact?.account_id || action.account_id;
                const actionAccountName = labelAccount(actionAccountId || null);
                const missingContact = !action.contact_id;

                return (
                  <div
                    key={action.id}
                    className={`rounded-lg border border-slate-200 bg-white p-4 ${
                      missingContact ? "cursor-pointer hover:bg-slate-50" : ""
                    }`}
                    onClick={() => {
                      if (missingContact) onOpenAssignContact(action);
                    }}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="text-base font-semibold text-slate-900">
                            {actionContact?.full_name || "No contact selected"}
                          </p>
                          {missingContact && (
                            <span className={`${chipBase} bg-amber-100 text-amber-800`}>
                              Missing contact
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-700">{actionAccountName}</p>
                        <p className="text-xs text-slate-600">Property: {labelProperty(action.property_id)}</p>
                        <p className="text-xs text-slate-500">
                          Due: {due.toLocaleString()}
                          {isOverdue ? " (overdue)" : isDueToday ? " (today)" : ""}
                        </p>
                        {action.notes && <p className="text-sm text-slate-700">{action.notes}</p>}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={buttonPrimary}
                          onClick={(e) => {
                            e.stopPropagation();
                            setCompleteAction(action);
                          }}
                        >
                          Complete
                        </button>
                        <button
                          type="button"
                          className={buttonMuted}
                          onClick={(e) => {
                            e.stopPropagation();
                            void onSnooze(action);
                          }}
                          disabled={busy === `snooze-${action.id}`}
                        >
                          {busy === `snooze-${action.id}` ? "Snoozing..." : "Snooze +2d"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {assignContactAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">Assign Contact</h3>
            <p className="text-sm text-slate-600">{labelProperty(assignContactAction.property_id)}</p>
            <input
              value={assignContactQuery}
              onChange={(e) => setAssignContactQuery(e.target.value)}
              className={input}
              placeholder="Search contacts..."
            />
            <div className="max-h-56 space-y-2 overflow-auto">
              {filteredAssignContacts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`w-full rounded-md border px-2.5 py-1.5 text-left text-sm ${
                    assignContactId === c.id
                      ? "border-slate-900 bg-slate-50 text-slate-900"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                  onClick={() => setAssignContactId(c.id)}
                >
                  <div className="font-medium">{c.full_name || "Unnamed contact"}</div>
                  <div className="text-xs text-slate-500">{labelAccount(c.account_id)}</div>
                </button>
              ))}
              {filteredAssignContacts.length === 0 && (
                <p className="text-sm text-slate-500">No contacts found.</p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className={buttonPrimary}
                onClick={() => void onSaveAssignContact()}
                disabled={busy === `assign-contact-${assignContactAction.id}`}
              >
                {busy === `assign-contact-${assignContactAction.id}` ? "Saving..." : "Save Contact"}
              </button>
              <button
                type="button"
                className={buttonMuted}
                onClick={() => {
                  setAssignContactAction(null);
                  setAssignContactId("");
                  setAssignContactQuery("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {completeAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            className="w-full max-w-xl space-y-3 rounded-2xl border border-slate-200 bg-white p-5"
            onSubmit={(e) => void onCompleteAction(e)}
          >
            <h3 className="text-lg font-semibold text-slate-900">Complete Next Action</h3>
            <p className="text-sm text-slate-600">{labelProperty(completeAction.property_id)}</p>

            <select
              name="touchpoint_type_id"
              className={input}
              defaultValue={completeAction.recommended_touchpoint_type_id || ""}
              required
            >
              <option value="">Select touchpoint type</option>
              {touchpointTypes.map((tt) => (
                <option key={tt.id} value={tt.id}>
                  {tt.name}
                </option>
              ))}
            </select>

            <select name="outcome_id" className={input} defaultValue="">
              <option value="">No outcome</option>
              {touchpointOutcomes.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>

            <select
              name="contact_id"
              className={input}
              defaultValue={completeAction.contact_id || ""}
              required
            >
              <option value="">No contact</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name || "Unnamed contact"}
                </option>
              ))}
            </select>

            <select name="account_id" className={input} defaultValue={completeAction.account_id || ""}>
              <option value="">Auto-derive account (recommended)</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || "Unnamed account"}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500">
              Account is optional. If omitted, it is derived from selected contact or property relationship.
            </p>

            <input
              name="happened_at"
              type="datetime-local"
              className={input}
              defaultValue={localDateTime()}
              required
            />

            <textarea name="notes" className={notesInput} placeholder="Notes" rows={4} />

            <div className="flex gap-2">
              <button
                type="submit"
                className={buttonPrimary}
                disabled={busy === `complete-${completeAction.id}`}
              >
                {busy === `complete-${completeAction.id}` ? "Saving..." : "Save + Complete"}
              </button>
              <button
                type="button"
                className={buttonMuted}
                onClick={() => setCompleteAction(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {accountModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            className={`w-full max-w-md space-y-3 ${card}`}
            onSubmit={(e) => void onCreateAccount(e)}
          >
            <h3 className="text-lg font-semibold text-slate-900">New Account</h3>
            <div className="grid gap-3">
              <div className="space-y-1">
                <label className={label}>Name</label>
                <input
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  className={input}
                  placeholder="Name"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className={label}>Type (optional)</label>
                <input
                  value={newAccountType}
                  onChange={(e) => setNewAccountType(e.target.value)}
                  className={input}
                  placeholder="Type"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className={buttonPrimary}
                disabled={busy === "create-account"}
              >
                {busy === "create-account" ? "Saving..." : "Save Account"}
              </button>
              <button
                type="button"
                className={buttonMuted}
                onClick={() => setAccountModalOpen(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {contactModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            className={`w-full max-w-md space-y-3 ${card}`}
            onSubmit={(e) => void onCreateContact(e)}
          >
            <h3 className="text-lg font-semibold text-slate-900">Add Contact</h3>
            <p className="text-xs text-slate-500">
              Account: {selectedAccount?.name || "Unknown account"}
            </p>
            {contactMismatchPrompt && (
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-2">
                <p className="text-xs text-amber-900">
                  {`This contact already belongs to ${contactMismatchPrompt.accountLabel}. Switch selected account to ${contactMismatchPrompt.accountLabel}?`}
                </p>
                <p className="text-xs text-amber-800">{contactMismatchPrompt.message}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={buttonPrimary}
                    onClick={() => void onSwitchToExistingContactAccount()}
                  >
                    Switch
                  </button>
                  <button
                    type="button"
                    className={buttonMuted}
                    onClick={() => setContactMismatchPrompt(null)}
                  >
                    Keep my account
                  </button>
                </div>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className={label}>First name</label>
                <input
                  value={newContactFirstName}
                  onChange={(e) => setNewContactFirstName(e.target.value)}
                  className={input}
                  placeholder="First name"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className={label}>Last name</label>
                <input
                  value={newContactLastName}
                  onChange={(e) => setNewContactLastName(e.target.value)}
                  className={input}
                  placeholder="Last name"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className={label}>Title</label>
                <input
                  value={newContactTitle}
                  onChange={(e) => setNewContactTitle(e.target.value)}
                  className={input}
                  placeholder="Title"
                />
              </div>
              <div className="space-y-1">
                <label className={label}>Email</label>
                <input
                  value={newContactEmail}
                  onChange={(e) => setNewContactEmail(e.target.value)}
                  className={input}
                  type="email"
                  placeholder="Email"
                />
              </div>
              <div className="space-y-1">
                <label className={label}>Phone</label>
                <input
                  value={newContactPhone}
                  onChange={(e) => setNewContactPhone(e.target.value)}
                  className={input}
                  placeholder="Phone"
                />
              </div>
              <div className="space-y-1">
                <label className={label}>Decision role</label>
                <input
                  value={newContactDecisionRole}
                  onChange={(e) => setNewContactDecisionRole(e.target.value)}
                  className={input}
                  placeholder="Decision role"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className={buttonPrimary}
                disabled={busy === "create-contact"}
              >
                {busy === "create-contact" ? "Saving..." : "Save Contact"}
              </button>
              <button
                type="button"
                className={buttonMuted}
                onClick={() => {
                  setContactModalOpen(false);
                  setContactMismatchPrompt(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {propertyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            className={`w-full max-w-md space-y-3 ${card}`}
            onSubmit={(e) => void onCreateProperty(e)}
          >
            <h3 className="text-lg font-semibold text-slate-900">New Property</h3>
            {!selectedAccountId && (
              <p className="text-xs text-slate-500">
                Optional account link will be skipped until an account is selected.
              </p>
            )}
            <div className="space-y-1">
              <label className={label}>Address line 1</label>
              <input
                value={newPropertyAddressLine1}
                onChange={(e) => setNewPropertyAddressLine1(e.target.value)}
                className={input}
                placeholder="Address line 1"
                required
              />
            </div>
            <div className="space-y-1">
              <label className={label}>Address line 2</label>
              <input
                value={newPropertyAddressLine2}
                onChange={(e) => setNewPropertyAddressLine2(e.target.value)}
                className={input}
                placeholder="Address line 2"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className={label}>City</label>
                <input
                  value={newPropertyCity}
                  onChange={(e) => setNewPropertyCity(e.target.value)}
                  className={input}
                  placeholder="City"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className={label}>State</label>
                <input
                  value={newPropertyState}
                  onChange={(e) => setNewPropertyState(e.target.value)}
                  className={input}
                  placeholder="State"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className={label}>Postal code</label>
                <input
                  value={newPropertyPostalCode}
                  onChange={(e) => setNewPropertyPostalCode(e.target.value)}
                  className={input}
                  placeholder="Postal code"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className={label}>Country</label>
                <input
                  value={newPropertyCountry}
                  onChange={(e) => setNewPropertyCountry(e.target.value)}
                  className={input}
                  placeholder="Country"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className={buttonPrimary}
                disabled={busy === "create-property"}
              >
                {busy === "create-property" ? "Saving..." : "Save Property"}
              </button>
              <button
                type="button"
                className={buttonMuted}
                onClick={() => setPropertyModalOpen(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-[60] rounded-lg border px-3 py-2 text-sm shadow ${
            toast.tone === "success"
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

function plusDayStart(startOfDay: Date) {
  const next = new Date(startOfDay);
  next.setDate(next.getDate() + 1);
  return next;
}
