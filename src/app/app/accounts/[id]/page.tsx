import { notFound } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import AccountDetailClient from "@/app/app/accounts/[id]/account-detail-client";
import { scoreAccount, type IcpScoreResult, type IcpCriteria } from "@/lib/scoring/icp-score";

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
    .select("id,name,account_type,status,notes,website,phone,created_by,updated_at")
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
      .select("id,address_line1,city,state,postal_code")
      .eq("primary_account_id", id)
      .is("deleted_at", null)
      .order("address_line1"),
    supabase
      .from("touchpoints")
      .select("id,happened_at,notes,engagement_phase,touchpoint_type_id,outcome_id,contact_id")
      .eq("account_id", id)
      .order("happened_at", { ascending: false })
      .limit(50),
    supabase.from("touchpoint_types").select("id,name,key,is_outreach").order("sort_order"),
    supabase.from("touchpoint_outcomes").select("id,name,touchpoint_type_id").order("sort_order"),
    supabase.from("org_users").select("role").eq("user_id", userId).maybeSingle(),
    // All properties not linked to this account (for linking)
    supabase
      .from("properties")
      .select("id,address_line1,city,state,postal_code")
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

  // ICP scoring
  const { data: icpProfiles } = await supabase
    .from("icp_profiles")
    .select("id")
    .eq("active", true);
  const profileIds = (icpProfiles ?? []).map((p) => p.id as string);

  let icpScore: IcpScoreResult = { score: 50, priority: 3, label: "Worth a conversation", matches: [], misses: ["No ICP configured"] };

  if (profileIds.length > 0) {
    const { data: criteriaRows } = await supabase
      .from("icp_criteria")
      .select("criteria_type,criteria_value")
      .in("icp_profile_id", profileIds);

    const criteria: IcpCriteria[] = (criteriaRows ?? []).map((c) => ({
      criteria_type: c.criteria_type as string,
      criteria_value: c.criteria_value as string,
    }));

    const props = propertiesRes.data ?? [];
    const contacts = contactsRes.data ?? [];
    const primaryContact = contacts[0];
    const largestProperty = props.reduce<{ sq_footage?: number | null; state?: string | null; roof_type?: string | null }>(
      (best, p) => best,
      {}
    );

    icpScore = scoreAccount(
      {
        account_type: accountRes.data.account_type as string | null,
        state: (props[0] as Record<string, unknown>)?.state as string | null,
        sq_footage: null, // no sq_footage on org properties yet
        roof_type: null,
        contact_title: primaryContact?.title as string | null,
      },
      criteria
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cast = <T,>(v: unknown) => (v ?? []) as T[];

  const availableProperties = (allPropsRes.data ?? []).map((p) => ({
    id: p.id as string,
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

  return (
    <AccountDetailClient
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
