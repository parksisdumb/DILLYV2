import { notFound } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import AccountDetailClient from "@/app/app/accounts/[id]/account-detail-client";

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

  // 2. Parallel: contacts, properties, touchpoints, lookup tables, user role
  const [contactsRes, propertiesRes, tpRes, ttRes, toRes, meRes] = await Promise.all([
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cast = <T,>(v: unknown) => (v ?? []) as T[];

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
    />
  );
}
