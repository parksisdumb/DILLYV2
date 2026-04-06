import { notFound } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import PropertyDetailClient from "@/app/app/properties/[id]/property-detail-client";

export type PropContact = {
  contact_id: string;
  role_label: string | null;
  is_primary: boolean;
  contact: { id: string; full_name: string | null; account_id: string };
};

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { supabase, userId, orgId } = await requireServerOrgContext();
  const { id } = await params;

  // 1. Property
  const propRes = await supabase
    .from("properties")
    .select(
      "id,name,address_line1,address_line2,city,state,postal_code,primary_account_id,primary_contact_id,notes,roof_type,roof_age_years,sq_footage,website,updated_at",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!propRes.data) notFound();

  const prop = propRes.data;

  // 2. Parallel: account (conditional), property contacts, opportunities, touchpoints, lookups, role
  const [
    accountRes,
    propContactsRes,
    oppsRes,
    tpRes,
    ttRes,
    toRes,
    scopeRes,
    stageRes,
    meRes,
    allContactsRes,
    allAccountsRes,
  ] = await Promise.all([
    prop.primary_account_id
      ? supabase
          .from("accounts")
          .select("id,name,account_type")
          .eq("id", prop.primary_account_id as string)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("property_contacts")
      .select("contact_id,role_label,is_primary,contacts(id,full_name,account_id)")
      .eq("property_id", id),
    supabase
      .from("opportunities")
      .select("id,title,status,estimated_value,scope_type_id,stage_id,primary_contact_id")
      .eq("property_id", id)
      .is("deleted_at", null)
      .order("opened_at", { ascending: false }),
    supabase
      .from("touchpoints")
      .select("id,happened_at,notes,engagement_phase,touchpoint_type_id,outcome_id,contact_id")
      .eq("property_id", id)
      .order("happened_at", { ascending: false })
      .limit(50),
    supabase.from("touchpoint_types").select("id,name,key,is_outreach").order("sort_order"),
    supabase.from("touchpoint_outcomes").select("id,name,touchpoint_type_id").order("sort_order"),
    supabase.from("scope_types").select("id,name,key").order("sort_order"),
    supabase.from("opportunity_stages").select("id,name,key,is_closed_stage").order("sort_order"),
    supabase.from("org_users").select("role").eq("user_id", userId).maybeSingle(),
    supabase.from("contacts").select("id,full_name,account_id").is("deleted_at", null).order("full_name"),
    supabase.from("accounts").select("id,name,account_type").is("deleted_at", null).order("name"),
  ]);

  // Extract typed property contacts from join
  const propContacts: PropContact[] = (propContactsRes.data ?? [])
    .map((pc) => ({
      contact_id: pc.contact_id as string,
      role_label: pc.role_label as string | null,
      is_primary: pc.is_primary as boolean,
      contact: pc.contacts as unknown as { id: string; full_name: string | null; account_id: string },
    }))
    .filter((pc) => pc.contact != null);

  // All contacts for linking (exclude already-linked ones)
  const linkedContactIds = new Set(propContacts.map((pc) => pc.contact_id));
  const availableContacts = (allContactsRes.data ?? [])
    .filter((c) => !linkedContactIds.has(c.id as string))
    .map((c) => ({ id: c.id as string, full_name: c.full_name as string | null }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cast = <T,>(v: unknown) => (v ?? []) as T[];

  const allAccounts = (allAccountsRes.data ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string | null,
    account_type: a.account_type as string | null,
  }));

  return (
    <PropertyDetailClient
      property={prop as any}
      account={(accountRes.data ?? null) as any}
      propContacts={propContacts}
      opportunities={cast(oppsRes.data)}
      touchpoints={cast(tpRes.data)}
      touchpointTypes={cast(ttRes.data)}
      touchpointOutcomes={cast(toRes.data)}
      scopeTypes={cast(scopeRes.data)}
      stages={cast(stageRes.data)}
      orgId={orgId}
      userId={userId}
      userRole={meRes.data?.role ?? "rep"}
      availableContacts={availableContacts}
      allAccounts={allAccounts}
    />
  );
}
