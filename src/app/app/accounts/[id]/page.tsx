import { notFound } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import AccountDetailClient from "@/app/app/accounts/[id]/account-detail-client";
import { scoreAccount, type IcpScoreResult } from "@/lib/scoring/icp-score";
import { accountCompleteness, withinDays } from "@/lib/completeness";

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
  const [contactsRes, propertiesRes, tpRes, ttRes, toRes, meRes, allPropsRes, allContactsRes] = await Promise.all([
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
      .select("id,happened_at,notes,engagement_phase,touchpoint_type_id,outcome_id,contact_id,direction")
      .eq("account_id", id)
      .order("happened_at", { ascending: false })
      .limit(50),
    supabase.from("touchpoint_types").select("id,name,key,is_outreach").order("sort_order"),
    supabase.from("touchpoint_outcomes").select("id,name,touchpoint_type_id").order("sort_order"),
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
  ]);

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
      touchpoints={cast(tpRes.data)}
      touchpointTypes={cast(ttRes.data)}
      touchpointOutcomes={cast(toRes.data)}
      userId={userId}
      orgId={orgId}
      userRole={meRes.data?.role ?? "rep"}
      availableProperties={availableProperties}
      availableContacts={availableContacts}
      icpScore={icpScore}
    />
  );
}
