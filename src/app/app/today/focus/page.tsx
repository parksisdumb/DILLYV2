import { redirect } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import FocusClient from "./focus-client";

// Subset of next_actions enriched with the data the session needs to render
// each contact card without further round-trips.
export type FocusQueueItem = {
  nextActionId: string;
  contactId: string;
  contactName: string;
  contactTitle: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  accountId: string | null;
  accountName: string;
  propertyId: string | null;
  propertyName: string | null;
  propertyAddress: string | null;
  notes: string | null;
  dueAt: string;
  recommendedTouchpointTypeId: string | null;
  // Outreach context
  lastOutcomeName: string | null;
  daysSinceLastOutreach: number | null;
};

export type FocusOutcome = { id: string; key: string; name: string };

export default async function FocusPage() {
  const { supabase, userId, orgId } = await requireServerOrgContext();

  // Fetch the rep's open queue + all the lookups needed to render contact cards.
  const [naRes, ttypeRes, outcomesRes, dashRes, streakRes] = await Promise.all([
    supabase
      .from("next_actions")
      .select(
        "id,contact_id,account_id,property_id,due_at,notes,recommended_touchpoint_type_id,created_from_touchpoint_id",
      )
      .eq("assigned_user_id", userId)
      .eq("status", "open")
      .not("contact_id", "is", null)
      .not("account_id", "is", null)
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
  ]);

  if (naRes.error) throw new Error(naRes.error.message);

  const queueRows = (naRes.data ?? []) as {
    id: string;
    contact_id: string;
    account_id: string;
    property_id: string | null;
    due_at: string;
    notes: string | null;
    recommended_touchpoint_type_id: string | null;
    created_from_touchpoint_id: string | null;
  }[];

  if (queueRows.length === 0) {
    // Empty queue — bounce back to Today
    redirect("/app/today");
  }

  // Resolve the org-specific 'call' touchpoint type id (preferred over global)
  type TtRow = { id: string; key: string; is_outreach: boolean; org_id: string | null };
  const ttypes = (ttypeRes.data ?? []) as TtRow[];
  const callTypes = ttypes.filter((t) => t.key === "call");
  const callTypeId =
    callTypes.find((t) => t.org_id !== null)?.id ?? callTypes.find((t) => t.org_id === null)?.id ?? null;

  // Outcomes — keep only the seven we surface in the session, in spec order
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
      // Prefer org-specific outcome row, fall back to global
      const candidates = allOutcomes.filter((o) => o.key === spec.key);
      const chosen =
        candidates.find((o) => o.org_id !== null) ?? candidates.find((o) => o.org_id === null) ?? null;
      return chosen ? { ...spec, id: chosen.id, name: chosen.name } : null;
    })
    .filter((o): o is { key: string; emoji: string; label: string; points: number; id: string; name: string } => o !== null);

  // Pull the contact / account / property / last-touchpoint context for every
  // contact in the queue using batched .in() queries — no N+1.
  const contactIds = Array.from(new Set(queueRows.map((q) => q.contact_id)));
  const accountIds = Array.from(new Set(queueRows.map((q) => q.account_id)));
  const propertyIds = Array.from(
    new Set(queueRows.map((q) => q.property_id).filter((v): v is string => Boolean(v))),
  );

  const [contactsRes, accountsRes, propsRes, lastTpsRes] = await Promise.all([
    supabase
      .from("contacts")
      .select("id,full_name,title,phone,email")
      .in("id", contactIds),
    supabase.from("accounts").select("id,name").in("id", accountIds),
    propertyIds.length > 0
      ? supabase.from("properties").select("id,name,address_line1,city,state").in("id", propertyIds)
      : Promise.resolve({ data: [] as { id: string; name: string | null; address_line1: string; city: string | null; state: string | null }[] }),
    supabase
      .from("touchpoints")
      .select("contact_id,happened_at,outcome_id")
      .in("contact_id", contactIds)
      .order("happened_at", { ascending: false }),
  ]);

  type ContactRow = { id: string; full_name: string | null; title: string | null; phone: string | null; email: string | null };
  type AccountRow = { id: string; name: string | null };
  type PropertyRow = { id: string; name: string | null; address_line1: string; city: string | null; state: string | null };

  const contactById = new Map<string, ContactRow>();
  for (const c of (contactsRes.data ?? []) as ContactRow[]) contactById.set(c.id, c);
  const accountById = new Map<string, AccountRow>();
  for (const a of (accountsRes.data ?? []) as AccountRow[]) accountById.set(a.id, a);
  const propertyById = new Map<string, PropertyRow>();
  for (const p of (propsRes.data ?? []) as PropertyRow[]) propertyById.set(p.id, p);

  // Latest touchpoint per contact
  const outcomeNameById = new Map<string, string>();
  for (const o of allOutcomes) outcomeNameById.set(o.id, o.name);
  const lastTpByContact = new Map<string, { happened_at: string; outcome_id: string | null }>();
  for (const tp of (lastTpsRes.data ?? []) as { contact_id: string; happened_at: string; outcome_id: string | null }[]) {
    if (!lastTpByContact.has(tp.contact_id)) {
      lastTpByContact.set(tp.contact_id, { happened_at: tp.happened_at, outcome_id: tp.outcome_id });
    }
  }

  const nowMs = Date.now();
  const queue: FocusQueueItem[] = queueRows
    .map((q): FocusQueueItem | null => {
      const c = contactById.get(q.contact_id);
      if (!c) return null;
      const account = accountById.get(q.account_id);
      const prop = q.property_id ? propertyById.get(q.property_id) ?? null : null;
      const lastTp = lastTpByContact.get(q.contact_id);
      const lastDays = lastTp ? Math.floor((nowMs - new Date(lastTp.happened_at).getTime()) / 86400000) : null;
      const lastOutcomeName = lastTp?.outcome_id ? outcomeNameById.get(lastTp.outcome_id) ?? null : null;
      return {
        nextActionId: q.id,
        contactId: c.id,
        contactName: c.full_name ?? "Unknown contact",
        contactTitle: c.title,
        contactPhone: c.phone,
        contactEmail: c.email,
        accountId: q.account_id,
        accountName: account?.name ?? "Unknown account",
        propertyId: q.property_id,
        propertyName: prop?.name ?? null,
        propertyAddress: prop ? [prop.address_line1, prop.city, prop.state].filter(Boolean).join(", ") : null,
        notes: q.notes,
        dueAt: q.due_at,
        recommendedTouchpointTypeId: q.recommended_touchpoint_type_id,
        lastOutcomeName,
        daysSinceLastOutreach: lastDays,
      };
    })
    .filter((v): v is FocusQueueItem => v !== null);

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
