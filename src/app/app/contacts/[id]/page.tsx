import { notFound } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import ContactDetailClient from "@/app/app/contacts/[id]/contact-detail-client";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { supabase, userId, orgId } = await requireServerOrgContext();
  const { id } = await params;

  // 1. Contact
  const contactRes = await supabase
    .from("contacts")
    .select("id,full_name,title,phone,email,decision_role,account_id,updated_at")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!contactRes.data) notFound();

  // 2. Parallel: account, touchpoints, next_actions, linked properties, lookup tables, role
  const [accountRes, tpRes, nextActionsRes, propContactsRes, ttRes, toRes, meRes] =
    await Promise.all([
      supabase
        .from("accounts")
        .select("id,name,account_type")
        .eq("id", contactRes.data.account_id as string)
        .single(),
      supabase
        .from("touchpoints")
        .select("id,happened_at,notes,engagement_phase,touchpoint_type_id,outcome_id,account_id")
        .eq("contact_id", id)
        .order("happened_at", { ascending: false })
        .limit(50),
      supabase
        .from("next_actions")
        .select("id,due_at,notes,status,property_id,recommended_touchpoint_type_id")
        .eq("contact_id", id)
        .eq("status", "open")
        .order("due_at"),
      supabase
        .from("property_contacts")
        .select("property_id,is_primary,properties(id,name,address_line1,city,state,building_type)")
        .eq("contact_id", id),
      supabase.from("touchpoint_types").select("id,name,key,is_outreach").order("sort_order"),
      supabase.from("touchpoint_outcomes").select("id,name,touchpoint_type_id").order("sort_order"),
      supabase.from("org_users").select("role").eq("user_id", userId).maybeSingle(),
    ]);

  // Extract linked properties (with is_primary from junction) — sorted primary-first then by name
  type LinkedProperty = {
    id: string;
    name: string | null;
    address_line1: string;
    city: string | null;
    state: string | null;
    building_type: string | null;
    is_primary: boolean;
  };
  const properties: LinkedProperty[] = (propContactsRes.data ?? [])
    .map((pc) => {
      const p = pc.properties as unknown as Omit<LinkedProperty, "is_primary"> | null;
      if (!p) return null;
      return { ...p, is_primary: Boolean(pc.is_primary) };
    })
    .filter((p): p is LinkedProperty => p !== null)
    .sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      return (a.name ?? a.address_line1).localeCompare(b.name ?? b.address_line1);
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cast = <T,>(v: unknown) => (v ?? []) as T[];

  return (
    <ContactDetailClient
      contact={contactRes.data as any}
      account={(accountRes.data ?? { id: "", name: null, account_type: null }) as any}
      properties={properties}
      touchpoints={cast(tpRes.data)}
      nextActions={cast(nextActionsRes.data)}
      touchpointTypes={cast(ttRes.data)}
      touchpointOutcomes={cast(toRes.data)}
      userId={userId}
      orgId={orgId}
      userRole={meRes.data?.role ?? "rep"}
    />
  );
}
