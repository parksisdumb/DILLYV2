
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import Scoreboard from "@/app/app/today/scoreboard";
import GrowForm from "@/app/app/today/grow-form";
import AdvanceList from "@/app/app/today/advance-list";
import SuggestedOutreach from "@/app/app/today/suggested-outreach";
import type { SuggestionRow } from "@/app/app/today/suggested-outreach";

type Tab = "grow" | "advance";

type Account = { id: string; name: string | null };
type Contact = { id: string; full_name: string | null; account_id: string };
type Property = { id: string; name: string | null; address_line1: string; city: string | null; state: string | null };
type TouchpointType = {
  id: string;
  name: string;
  key?: string | null;
  is_outreach: boolean;
};
type Outcome = { id: string; name: string; touchpoint_type_id?: string | null };

type NextAction = {
  id: string;
  property_id: string | null;
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
  first_touch_outreach_today: number;
  follow_up_outreach_today: number;
  target_first_touch_outreach: number;
  target_follow_up_outreach: number;
  remaining_first_touch_outreach: number;
  remaining_follow_up_outreach: number;
  next_actions_due_today: number;
  next_actions_overdue: number;
  streak: number;
};

type OutreachResult = {
  awarded_points: number;
  outreach_count_today: number;
  outreach_target: number;
  outreach_remaining: number;
};

const buttonMuted =
  "rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50";

const toNumber = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const OUTREACH_TYPE_KEYS = new Set(["call", "email", "text", "door_knock", "site_visit"]);

/** Deduplicate rows by `key`, preferring org-specific (org_id != null) over global. */
function dedupeByKey<T extends { key?: string | null; org_id?: string | null }>(
  rows: T[],
): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    const k = row.key ?? row.org_id ?? "";
    const existing = map.get(k);
    if (!existing || (row.org_id && !existing.org_id)) {
      map.set(k, row);
    }
  }
  return Array.from(map.values());
}

export default function TodayClient({ userId }: { userId: string }) {
  const supabase = useMemo(() => createBrowserSupabase(), []);

  const [tab, setTab] = useState<Tab>("grow");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [orgId, setOrgId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [touchpointTypes, setTouchpointTypes] = useState<TouchpointType[]>([]);
  const [touchpointOutcomes, setTouchpointOutcomes] = useState<Outcome[]>([]);
  const [nextActions, setNextActions] = useState<NextAction[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);

  const [dashboard, setDashboard] = useState<DashboardRow>({
    points_today: 0,
    outreach_today: 0,
    outreach_target: 20,
    outreach_remaining: 20,
    first_touch_outreach_today: 0,
    follow_up_outreach_today: 0,
    target_first_touch_outreach: 20,
    target_follow_up_outreach: 10,
    remaining_first_touch_outreach: 20,
    remaining_follow_up_outreach: 10,
    next_actions_due_today: 0,
    next_actions_overdue: 0,
    streak: 0,
  });

  const outreachTypes = useMemo(
    () => touchpointTypes.filter((t) => t.is_outreach),
    [touchpointTypes],
  );

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const contactsById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);

  const overdueCount = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return nextActions.filter((a) => new Date(a.due_at) < startOfToday).length;
  }, [nextActions]);

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

      setOrgId(me.org_id);

      const [a, c, p, to, na, dash] = await Promise.all([
        supabase.from("accounts").select("id,name").is("deleted_at", null),
        supabase
          .from("contacts")
          .select("id,full_name,account_id")
          .is("deleted_at", null),
        supabase
          .from("properties")
          .select("id,name,address_line1,city,state")
          .is("deleted_at", null),
        supabase
          .from("touchpoint_outcomes")
          .select("id,name,touchpoint_type_id,org_id,key")
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
        .select("id,name,key,is_outreach,org_id")
        .order("sort_order");

      let resolvedTouchpointTypes: TouchpointType[] = [];
      if (ttWithOutreach.error) {
        const msg = ttWithOutreach.error.message.toLowerCase();
        if (ttWithOutreach.error.code === "42703" || msg.includes("is_outreach")) {
          const ttFallback = await supabase
            .from("touchpoint_types")
            .select("id,name,key")
            .order("sort_order");

          if (ttFallback.error) throw new Error(ttFallback.error.message);

          resolvedTouchpointTypes = dedupeByKey(
            ((ttFallback.data ?? []) as (TouchpointType & { org_id?: string | null })[]).map((tt) => ({
              id: tt.id,
              name: tt.name,
              key: tt.key ?? null,
              is_outreach: OUTREACH_TYPE_KEYS.has((tt.key ?? "").toLowerCase()),
              org_id: tt.org_id ?? null,
            })),
          );
        } else {
          throw new Error(ttWithOutreach.error.message);
        }
      } else {
        resolvedTouchpointTypes = dedupeByKey(
          ((ttWithOutreach.data ?? []) as (TouchpointType & { org_id?: string | null })[]).map((tt) => ({
            id: tt.id,
            name: tt.name,
            key: tt.key ?? null,
            is_outreach: Boolean(tt.is_outreach),
            org_id: tt.org_id ?? null,
          })),
        );
      }

      setAccounts((a.data ?? []) as Account[]);
      setContacts((c.data ?? []) as Contact[]);
      setProperties((p.data ?? []) as Property[]);
      setTouchpointTypes(resolvedTouchpointTypes);
      setTouchpointOutcomes(
        dedupeByKey(
          ((to.data ?? []) as (Outcome & { org_id?: string | null; key?: string | null })[]).map((o) => ({
            id: o.id,
            name: o.name,
            touchpoint_type_id: o.touchpoint_type_id ?? null,
            key: o.key ?? null,
            org_id: o.org_id ?? null,
          })),
        ) as Outcome[],
      );
      setNextActions((na.data ?? []) as NextAction[]);

      // Fetch suggested outreach for this rep
      const { data: sugData } = await supabase
        .from("suggested_outreach")
        .select("id,prospect_id,rank_score,reason_codes,prospects(company_name,email,phone,website,city,state,account_type,source_detail,confidence_score,notes)")
        .eq("user_id", userId)
        .eq("status", "new")
        .order("rank_score", { ascending: false })
        .limit(10);
      const mapped: SuggestionRow[] = ((sugData ?? []) as Record<string, unknown>[]).map((s) => {
        const pr = (s.prospects ?? {}) as Record<string, unknown>;
        return {
          id: s.id as string,
          prospect_id: s.prospect_id as string,
          rank_score: s.rank_score as number,
          reason_codes: (s.reason_codes ?? []) as string[],
          company_name: (pr.company_name as string) ?? "Unknown",
          email: (pr.email as string | null) ?? null,
          phone: (pr.phone as string | null) ?? null,
          website: (pr.website as string | null) ?? null,
          city: (pr.city as string | null) ?? null,
          state: (pr.state as string | null) ?? null,
          account_type: (pr.account_type as string | null) ?? null,
          source_detail: (pr.source_detail as string | null) ?? null,
          confidence_score: (pr.confidence_score as number | null) ?? null,
          notes: (pr.notes as string | null) ?? null,
        };
      });
      setSuggestions(mapped);

      const dashRow = Array.isArray(dash.data)
        ? ((dash.data[0] as Partial<DashboardRow> | undefined) ?? undefined)
        : undefined;

      setDashboard({
        points_today: toNumber(dashRow?.points_today, 0),
        outreach_today: toNumber(dashRow?.outreach_today, 0),
        outreach_target: toNumber(dashRow?.outreach_target, 20),
        outreach_remaining: toNumber(dashRow?.outreach_remaining, 20),
        first_touch_outreach_today: toNumber(dashRow?.first_touch_outreach_today, 0),
        follow_up_outreach_today: toNumber(dashRow?.follow_up_outreach_today, 0),
        target_first_touch_outreach: toNumber(dashRow?.target_first_touch_outreach, 20),
        target_follow_up_outreach: toNumber(dashRow?.target_follow_up_outreach, 10),
        remaining_first_touch_outreach: toNumber(dashRow?.remaining_first_touch_outreach, 20),
        remaining_follow_up_outreach: toNumber(dashRow?.remaining_follow_up_outreach, 10),
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

  // ── Grow: partial scoreboard update (no full reload) ───────────────────

  async function handleGrowSuccess(result: OutreachResult) {
    setDashboard((prev) => ({
      ...prev,
      first_touch_outreach_today: prev.first_touch_outreach_today + 1,
      remaining_first_touch_outreach: Math.max(0, prev.remaining_first_touch_outreach - 1),
      outreach_today: result.outreach_count_today,
      outreach_remaining: result.outreach_remaining,
      outreach_target: result.outreach_target,
    }));

    // Silently refresh next_actions so the Advance tab reflects any newly scheduled follow-up
    const { data } = await supabase
      .from("next_actions")
      .select(
        "id,property_id,contact_id,account_id,opportunity_id,due_at,notes,recommended_touchpoint_type_id",
      )
      .eq("assigned_user_id", userId)
      .eq("status", "open")
      .order("due_at");
    if (data) setNextActions(data as NextAction[]);
  }

  // ── Advance: full reload after complete/snooze ─────────────────────────

  function handleActionCompleted() {
    showToast("success", "Done!");
    void load();
  }

  // ── Suggested outreach handlers ───────────────────────────────────────

  async function handleAcceptSuggestion(s: SuggestionRow) {
    // Mark accepted
    await supabase
      .from("suggested_outreach")
      .update({ status: "accepted" })
      .eq("id", s.id);
    setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
    // Switch to Grow tab — rep will use the "Add new contact" flow with prospect context in mind
    setTab("grow");
    showToast("success", `Starting outreach for ${s.company_name}`);
  }

  function handleDismissSuggestion(id: string) {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) return <p className="text-sm text-slate-600">Loading Today...</p>;
  if (error)
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {error}
      </div>
    );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Today</h1>

      <Scoreboard dashboard={dashboard} />

      {/* Tab switcher */}
      <div className="flex gap-2">
        <button
          className={`${buttonMuted} ${tab === "grow" ? "border-blue-600 bg-blue-600 text-white" : ""}`}
          onClick={() => setTab("grow")}
        >
          Grow
        </button>
        <button
          className={`${buttonMuted} ${tab === "advance" ? "border-blue-600 bg-blue-600 text-white" : ""}`}
          onClick={() => setTab("advance")}
        >
          Advance
          {overdueCount > 0 && (
            <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-semibold text-white">
              {overdueCount}
            </span>
          )}
        </button>
      </div>

      {tab === "grow" && orgId && (
        <GrowForm
          userId={userId}
          orgId={orgId}
          contacts={contacts}
          accounts={accounts}
          accountsById={accountsById}
          properties={properties}
          outreachTypes={outreachTypes}
          outcomes={touchpointOutcomes}
          onSuccess={handleGrowSuccess}
        />
      )}

      {/* New Prospects — always visible between Grow and Advance */}
      <SuggestedOutreach
        suggestions={suggestions}
        onAccept={(s) => void handleAcceptSuggestion(s)}
        onDismiss={handleDismissSuggestion}
      />

      {tab === "advance" && (
        <AdvanceList
          userId={userId}
          nextActions={nextActions}
          contactsById={contactsById}
          accountsById={accountsById}
          outreachTypes={outreachTypes}
          outcomes={touchpointOutcomes}
          onActionCompleted={handleActionCompleted}
        />
      )}

      {toast && (
        <div
          className={`fixed bottom-20 right-4 z-60 rounded-lg border px-3 py-2 text-sm shadow md:bottom-4 ${
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
