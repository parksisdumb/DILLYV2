import { redirect } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import FocusClient from "./focus-client";

// Discriminated union — every queue item has the same display shape, but
// kind-specific fields drive the outcome handler:
//   follow_up: existing path — log a touchpoint via rpc_log_outreach_touchpoint.
//   prospect:  rep is making first touch — call rpc_convert_prospect to create
//              account+contact+touchpoint, then mark suggestion converted.
type FocusBase = {
  sortKey: string;
  primaryName: string;
  contactDisplay: string;
  phone: string | null;
  propertyDisplay: string | null;
  notes: string | null;
  lastOutcomeName: string | null;
  daysSinceLastOutreach: number | null;
};

export type FocusFollowUpItem = FocusBase & {
  kind: "follow_up";
  nextActionId: string;
  contactId: string;
  accountId: string;
  propertyId: string | null;
};

export type FocusProspectItem = FocusBase & {
  kind: "prospect";
  suggestionId: string;
  prospectId: string;
  // Conversion payload for rpc_convert_prospect
  companyName: string;
  accountType: string | null;
  accountWebsite: string | null;
  accountPhone: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactTitle: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
};

export type FocusQueueItem = FocusFollowUpItem | FocusProspectItem;

export default async function FocusPage() {
  const { supabase, userId, orgId } = await requireServerOrgContext();

  // Date boundary for "due today or earlier" filter on next_actions
  const startOfTomorrow = new Date();
  startOfTomorrow.setHours(0, 0, 0, 0);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [naRes, ttypeRes, outcomesRes, dashRes, streakRes, sugRes] = await Promise.all([
    supabase
      .from("next_actions")
      .select(
        "id,contact_id,account_id,property_id,due_at,notes,recommended_touchpoint_type_id,created_from_touchpoint_id",
      )
      .eq("assigned_user_id", userId)
      .eq("status", "open")
      .not("contact_id", "is", null)
      .not("account_id", "is", null)
      .lt("due_at", startOfTomorrow.toISOString())
      .order("due_at"),
    supabase
      .from("touchpoint_types")
      .select("id,key,is_outreach,org_id")
      .order("sort_order"),
    supabase
      .from("touchpoint_outcomes")
      .select("id,key,name,org_id,touchpoint_type_id")
      .order("sort_order"),
    supabase.rpc("rpc_today_dashboard"),
    supabase
      .from("streaks")
      .select("current_count")
      .eq("user_id", userId)
      .eq("streak_type", "daily_outreach")
      .maybeSingle(),
    supabase
      .from("suggested_outreach")
      .select(
        "id,prospect_id,rank_score,prospects(id,company_name,account_type,website,phone,email,address_line1,city,state,postal_code,contact_first_name,contact_last_name,contact_title,notes)",
      )
      .eq("user_id", userId)
      .eq("status", "new")
      .order("rank_score", { ascending: false }),
  ]);

  if (naRes.error) throw new Error(naRes.error.message);

  // Resolve org-specific 'call' touchpoint type id (preferred over global)
  type TtRow = { id: string; key: string; is_outreach: boolean; org_id: string | null };
  const ttypes = (ttypeRes.data ?? []) as TtRow[];
  const callTypes = ttypes.filter((t) => t.key === "call");
  const callTypeId =
    callTypes.find((t) => t.org_id !== null)?.id ?? callTypes.find((t) => t.org_id === null)?.id ?? null;

  // Outcome buttons in spec order
  type OutcomeRow = { id: string; key: string; name: string; org_id: string | null; touchpoint_type_id: string | null };
  const allOutcomes = (outcomesRes.data ?? []) as OutcomeRow[];
  const wantedOutcomeKeys: { key: string; emoji: string; label: string; points: number }[] = [
    { key: "connected_conversation", emoji: "✅", label: "Connected", points: 3 },
    { key: "no_answer_no_voicemail", emoji: "📵", label: "No Answer", points: 1 },
    { key: "no_answer_voicemail", emoji: "📬", label: "Left Voicemail", points: 1 },
    { key: "gatekeeper", emoji: "🚪", label: "Gatekeeper", points: 1 },
    { key: "inspection_scheduled", emoji: "📅", label: "Scheduled Inspection", points: 10 },
    { key: "not_interested", emoji: "❌", label: "Not Interested", points: 1 },
  ];
  const outcomeButtons = wantedOutcomeKeys
    .map((spec) => {
      const candidates = allOutcomes.filter((o) => o.key === spec.key);
      const chosen =
        candidates.find((o) => o.org_id !== null) ?? candidates.find((o) => o.org_id === null) ?? null;
      return chosen ? { ...spec, id: chosen.id, name: chosen.name } : null;
    })
    .filter((o): o is { key: string; emoji: string; label: string; points: number; id: string; name: string } => o !== null);

  // ── Build follow_up items ───────────────────────────────────────────────
  const naRows = (naRes.data ?? []) as {
    id: string;
    contact_id: string;
    account_id: string;
    property_id: string | null;
    due_at: string;
    notes: string | null;
    recommended_touchpoint_type_id: string | null;
    created_from_touchpoint_id: string | null;
  }[];

  const contactIds = Array.from(new Set(naRows.map((q) => q.contact_id)));
  const accountIds = Array.from(new Set(naRows.map((q) => q.account_id)));
  const propertyIds = Array.from(new Set(naRows.map((q) => q.property_id).filter((v): v is string => Boolean(v))));

  const [contactsRes, accountsRes, propsRes, lastTpsRes] = await Promise.all([
    contactIds.length > 0
      ? supabase.from("contacts").select("id,full_name,title,phone,email,account_id").in("id", contactIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; title: string | null; phone: string | null; email: string | null; account_id: string }[] }),
    accountIds.length > 0
      ? supabase.from("accounts").select("id,name").in("id", accountIds)
      : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
    propertyIds.length > 0
      ? supabase.from("properties").select("id,name,address_line1,city,state").in("id", propertyIds)
      : Promise.resolve({ data: [] as { id: string; name: string | null; address_line1: string; city: string | null; state: string | null }[] }),
    contactIds.length > 0
      ? supabase
          .from("touchpoints")
          .select("contact_id,happened_at,outcome_id")
          .in("contact_id", contactIds)
          .order("happened_at", { ascending: false })
      : Promise.resolve({ data: [] as { contact_id: string; happened_at: string; outcome_id: string | null }[] }),
  ]);

  type ContactRow = { id: string; full_name: string | null; title: string | null; phone: string | null; email: string | null; account_id: string };
  type AccountRow = { id: string; name: string | null };
  type PropertyRow = { id: string; name: string | null; address_line1: string; city: string | null; state: string | null };

  const contactById = new Map<string, ContactRow>();
  for (const c of (contactsRes.data ?? []) as ContactRow[]) contactById.set(c.id, c);
  const accountById = new Map<string, AccountRow>();
  for (const a of (accountsRes.data ?? []) as AccountRow[]) accountById.set(a.id, a);
  const propertyById = new Map<string, PropertyRow>();
  for (const p of (propsRes.data ?? []) as PropertyRow[]) propertyById.set(p.id, p);

  const outcomeNameById = new Map<string, string>();
  for (const o of allOutcomes) outcomeNameById.set(o.id, o.name);

  const lastTpByContact = new Map<string, { happened_at: string; outcome_id: string | null }>();
  for (const tp of (lastTpsRes.data ?? []) as { contact_id: string; happened_at: string; outcome_id: string | null }[]) {
    if (!lastTpByContact.has(tp.contact_id)) {
      lastTpByContact.set(tp.contact_id, { happened_at: tp.happened_at, outcome_id: tp.outcome_id });
    }
  }

  const nowMs = Date.now();
  const todayStartMs = startOfToday.getTime();
  const followUpItems: FocusFollowUpItem[] = naRows
    .map((q): FocusFollowUpItem | null => {
      const c = contactById.get(q.contact_id);
      if (!c) return null;
      const account = accountById.get(q.account_id);
      const prop = q.property_id ? propertyById.get(q.property_id) ?? null : null;
      const lastTp = lastTpByContact.get(q.contact_id);
      const lastDays = lastTp ? Math.floor((nowMs - new Date(lastTp.happened_at).getTime()) / 86400000) : null;
      const lastOutcomeName = lastTp?.outcome_id ? outcomeNameById.get(lastTp.outcome_id) ?? null : null;
      const dueMs = new Date(q.due_at).getTime();
      // sortKey: 0_<iso> for overdue, 1_<iso> for today
      const sortBucket = dueMs < todayStartMs ? "0" : "1";
      return {
        kind: "follow_up",
        sortKey: `${sortBucket}_${q.due_at}`,
        nextActionId: q.id,
        contactId: c.id,
        accountId: q.account_id,
        propertyId: q.property_id,
        primaryName: account?.name ?? "Unknown account",
        contactDisplay: c.title ? `${c.full_name ?? "Unknown"} · ${c.title}` : (c.full_name ?? "Unknown"),
        phone: c.phone,
        propertyDisplay: prop ? (prop.name ?? [prop.address_line1, prop.city, prop.state].filter(Boolean).join(", ")) : null,
        notes: q.notes,
        lastOutcomeName,
        daysSinceLastOutreach: lastDays,
      };
    })
    .filter((v): v is FocusFollowUpItem => v !== null);

  // ── Build prospect items ────────────────────────────────────────────────
  type SuggestionRaw = {
    id: string;
    prospect_id: string;
    rank_score: number;
    prospects: {
      id: string;
      company_name: string;
      account_type: string | null;
      website: string | null;
      phone: string | null;
      email: string | null;
      address_line1: string | null;
      city: string | null;
      state: string | null;
      postal_code: string | null;
      contact_first_name: string | null;
      contact_last_name: string | null;
      contact_title: string | null;
      notes: string | null;
    } | null;
  };

  // Sort key for suggestions: "2_<padded-negative-rank>" so higher rank sorts first
  // within the suggestions bucket (and after any follow_up bucket).
  const sugRows = (sugRes.data ?? []) as unknown as SuggestionRaw[];
  const prospectItems: FocusProspectItem[] = sugRows
    .filter((s) => s.prospects !== null)
    .map((s, idx): FocusProspectItem => {
      const p = s.prospects!;
      const contactFull = [p.contact_first_name, p.contact_last_name].filter(Boolean).join(" ");
      const contactDisplay = contactFull
        ? p.contact_title
          ? `${contactFull} · ${p.contact_title}`
          : contactFull
        : (p.contact_title ?? "Contact unknown");
      const cityState = [p.city, p.state].filter(Boolean).join(", ") || null;
      // Pad rank to 6 digits, invert via subtraction so DESC sort works as ASC string compare.
      // idx tiebreaks on identical scores in original DESC order.
      const invertedRank = String(999999 - Math.min(999999, Math.max(0, Math.floor(s.rank_score)))).padStart(6, "0");
      return {
        kind: "prospect",
        sortKey: `2_${invertedRank}_${idx.toString().padStart(4, "0")}`,
        suggestionId: s.id,
        prospectId: p.id,
        companyName: p.company_name,
        accountType: p.account_type,
        accountWebsite: p.website,
        accountPhone: p.phone,
        contactFirstName: p.contact_first_name,
        contactLastName: p.contact_last_name,
        contactTitle: p.contact_title,
        contactEmail: p.email,
        contactPhone: p.phone,
        primaryName: p.company_name,
        contactDisplay,
        phone: p.phone,
        propertyDisplay: cityState,
        notes: p.notes,
        lastOutcomeName: null,
        daysSinceLastOutreach: null,
      };
    });

  // Combined queue, sorted by sortKey ascending
  const queue: FocusQueueItem[] = [...followUpItems, ...prospectItems].sort((a, b) =>
    a.sortKey.localeCompare(b.sortKey),
  );

  if (queue.length === 0) {
    redirect("/app/today");
  }

  // Dashboard fields for daily target + streak
  type DashRow = { outreach_today: number; outreach_target: number; streak: number };
  const dashRow = Array.isArray(dashRes.data) ? (dashRes.data[0] as DashRow | undefined) : (dashRes.data as DashRow | undefined);
  const outreachToday = Number(dashRow?.outreach_today ?? 0);
  const outreachTarget = Number(dashRow?.outreach_target ?? 20);
  const streak = Number(streakRes.data?.current_count ?? dashRow?.streak ?? 0);

  return (
    <FocusClient
      queue={queue}
      outcomeButtons={outcomeButtons}
      callTypeId={callTypeId}
      outreachToday={outreachToday}
      outreachTarget={outreachTarget}
      streakAtStart={streak}
      orgId={orgId}
      userId={userId}
    />
  );
}
