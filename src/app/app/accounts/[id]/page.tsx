import { notFound } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import AccountDetailClient from "@/app/app/accounts/[id]/account-detail-client";
import { scoreAccount, type IcpScoreResult } from "@/lib/scoring/icp-score";
import { accountCompleteness, withinDays } from "@/lib/completeness";
import { mergeTimeline } from "@/lib/timeline";

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { supabase, userId, orgId } = await requireServerOrgContext();
  const { id } = await params;

  // 1. Account — RLS ensures it belongs to org
  const accountRes = await supabase
    .from("accounts")
    .select("id,name,account_type,status,onboarding_status,notes,website,phone,created_by,updated_at")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!accountRes.data) notFound();

  // 2. Parallel: contacts, properties, touchpoints, lookup tables, user role, all unlinked entities
  const [contactsRes, propertiesRes, tpRes, ttRes, toRes, meRes, allPropsRes, allContactsRes, nextTouchRes] = await Promise.all([
    supabase
      .from("contacts")
      .select("id,full_name,title,phone,email,decision_role,updated_at")
      .eq("account_id", id)
      .is("deleted_at", null)
      .order("full_name"),
    supabase
      .from("properties")
      .select("id,name,address_line1,city,state,postal_code")
      .eq("primary_account_id", id)
      .is("deleted_at", null)
      .order("address_line1"),
    supabase
      .from("touchpoints")
      .select("id,happened_at,notes,engagement_phase,touchpoint_type_id,outcome_id,contact_id,property_id,account_id,direction")
      .eq("account_id", id)
      .order("happened_at", { ascending: false })
      .limit(50),
    supabase.from("touchpoint_types").select("id,name,key,is_outreach").order("sort_order"),
    supabase.from("touchpoint_outcomes").select("id,name,key,touchpoint_type_id").order("sort_order"),
    supabase.from("org_users").select("role").eq("user_id", userId).maybeSingle(),
    // All properties not linked to this account (for linking)
    supabase
      .from("properties")
      .select("id,name,address_line1,city,state,postal_code")
      .or(`primary_account_id.is.null,primary_account_id.neq.${id}`)
      .is("deleted_at", null)
      .order("address_line1"),
    // All contacts not belonging to this account (for linking)
    supabase
      .from("contacts")
      .select("id,full_name,title,account_id")
      .neq("account_id", id)
      .is("deleted_at", null)
      .order("full_name"),
    // Soonest open follow-up for this account — the "Next touch" banner.
    supabase
      .from("next_actions")
      .select("due_at,notes")
      .eq("account_id", id)
      .eq("status", "open")
      .order("due_at")
      .limit(1)
      .maybeSingle(),
  ]);

  // 2b. Related-activity timeline: this account's touchpoints PLUS touchpoints on
  // its contacts and its properties — so a touch logged on a contact/property
  // shows on the account. Two extra batched queries (no N+1); the direct set is
  // already fetched. Capped id-lists guard the URL length for large portfolios.
  const TP_COLS =
    "id,happened_at,notes,engagement_phase,touchpoint_type_id,outcome_id,contact_id,property_id,account_id,direction";
  const acctContactIds = (contactsRes.data ?? []).map((c) => c.id as string).slice(0, 500);
  const acctPropIds = (propertiesRes.data ?? []).map((p) => p.id as string).slice(0, 500);
  const emptyTp = Promise.resolve({ data: [] as Record<string, unknown>[] });
  const [viaContactRes, viaPropRes] = await Promise.all([
    acctContactIds.length > 0
      ? supabase.from("touchpoints").select(TP_COLS).in("contact_id", acctContactIds).order("happened_at", { ascending: false }).limit(50)
      : emptyTp,
    acctPropIds.length > 0
      ? supabase.from("touchpoints").select(TP_COLS).in("property_id", acctPropIds).order("happened_at", { ascending: false }).limit(50)
      : emptyTp,
  ]);

  const acctContactName = new Map((contactsRes.data ?? []).map((c) => [c.id as string, (c.full_name as string | null) ?? "contact"]));
  const acctPropName = new Map(
    (propertiesRes.data ?? []).map((p) => [p.id as string, ((p.name as string | null) || (p.address_line1 as string | null)) ?? "property"]),
  );
  type TpRow = { id: string; happened_at: string; account_id: string | null; contact_id: string | null; property_id: string | null };
  const timeline = mergeTimeline<TpRow>(
    [
      { rows: (tpRes.data ?? []) as unknown as TpRow[], labelFor: () => null },
      {
        rows: (viaContactRes.data ?? []) as unknown as TpRow[],
        labelFor: (r) => (r.account_id === id ? null : `via ${acctContactName.get(r.contact_id ?? "") ?? "contact"}`),
      },
      {
        rows: (viaPropRes.data ?? []) as unknown as TpRow[],
        labelFor: (r) => (r.account_id === id ? null : `via ${acctPropName.get(r.property_id ?? "") ?? "property"}`),
      },
    ],
    50,
  );

  // 3. Opportunities — needs property IDs from step 2
  const propertyIds = (propertiesRes.data ?? []).map((p) => p.id as string);
  const oppsData =
    propertyIds.length > 0
      ? (
          await supabase
            .from("opportunities")
            .select("id,title,status,estimated_value,opened_at,closed_at,property_id")
            .in("property_id", propertyIds)
            .is("deleted_at", null)
            .order("opened_at", { ascending: false })
        ).data ?? []
      : [];

  // ICP scoring — computed live from the account's CURRENT portfolio, contacts, and
  // recency, so it stays fresh as properties/contacts/touchpoints change. No stored
  // score to drift; this read IS the recompute.
  const icpScore: IcpScoreResult = scoreAccount({
    account_type: accountRes.data.account_type as string | null,
    property_count: (propertiesRes.data ?? []).length,
    contact_count: (contactsRes.data ?? []).length,
    last_touch_at: (tpRes.data?.[0]?.happened_at as string | undefined) ?? null,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cast = <T,>(v: unknown) => (v ?? []) as T[];

  const availableProperties = (allPropsRes.data ?? []).map((p) => ({
    id: p.id as string,
    name: (p as Record<string, unknown>).name as string | null ?? null,
    address_line1: p.address_line1 as string,
    city: p.city as string | null,
    state: p.state as string | null,
    postal_code: p.postal_code as string | null,
  }));

  const availableContacts = (allContactsRes.data ?? []).map((c) => ({
    id: c.id as string,
    full_name: c.full_name as string | null,
    title: c.title as string | null,
  }));

  const completeness = accountCompleteness({
    account_type: accountRes.data.account_type as string | null,
    website: accountRes.data.website as string | null,
    hasContact: (contactsRes.data ?? []).length > 0,
    hasProperty: (propertiesRes.data ?? []).length > 0,
    recentTouch: withinDays((tpRes.data?.[0]?.happened_at as string | undefined) ?? null, 90),
    onboarding_status: (accountRes.data as Record<string, unknown>).onboarding_status as string | null ?? "initial_touch",
    hasWonOpportunity: oppsData.some((o) => (o as { status?: string }).status === "won"),
  });

  return (
    <AccountDetailClient
      completeness={completeness}
      account={accountRes.data as any}
      contacts={cast(contactsRes.data)}
      properties={cast(propertiesRes.data)}
      opportunities={cast(oppsData)}
      touchpoints={cast(timeline)}
      touchpointTypes={cast(ttRes.data)}
      touchpointOutcomes={cast(toRes.data)}
      userId={userId}
      orgId={orgId}
      userRole={meRes.data?.role ?? "rep"}
      availableProperties={availableProperties}
      availableContacts={availableContacts}
      icpScore={icpScore}
      nextTouch={(nextTouchRes.data as { due_at: string; notes: string | null } | null) ?? null}
    />
  );
}
