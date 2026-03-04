import { notFound } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import OpportunityDetailClient from "@/app/app/opportunities/[id]/opportunity-detail-client";

export type OppMilestone = {
  id: string;
  happened_at: string;
  notes: string | null;
  milestone_type_id: string;
  milestone_types: { id: string; name: string; key: string } | null;
};

export type OppAssignment = {
  user_id: string;
  assignment_role: string;
  is_primary: boolean;
};

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { supabase, userId, orgId } = await requireServerOrgContext();
  const { id } = await params;

  const oppRes = await supabase
    .from("opportunities")
    .select(
      "id,title,status,estimated_value,bid_value,final_value,stage_id,scope_type_id,property_id,account_id,primary_contact_id,opened_at,closed_at,lost_reason_type_id,lost_notes,updated_at",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!oppRes.data) notFound();
  const opp = oppRes.data;

  const [
    propRes,
    accountRes,
    contactRes,
    milestonesRes,
    stagesRes,
    scopeRes,
    lostReasonsRes,
    milestoneTypesRes,
    assignmentsRes,
    orgUsersRes,
    meRes,
  ] = await Promise.all([
    opp.property_id
      ? supabase
          .from("properties")
          .select("id,address_line1,address_line2,city,state,postal_code")
          .eq("id", opp.property_id as string)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    opp.account_id
      ? supabase
          .from("accounts")
          .select("id,name,account_type")
          .eq("id", opp.account_id as string)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    opp.primary_contact_id
      ? supabase
          .from("contacts")
          .select("id,full_name,title,phone,email")
          .eq("id", opp.primary_contact_id as string)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("opportunity_milestones")
      .select("id,happened_at,notes,milestone_type_id,milestone_types(id,name,key)")
      .eq("opportunity_id", id)
      .order("happened_at", { ascending: false }),
    supabase
      .from("opportunity_stages")
      .select("id,name,key,sort_order,is_closed_stage")
      .order("sort_order"),
    supabase.from("scope_types").select("id,name,key").order("sort_order"),
    supabase.from("lost_reason_types").select("id,name,key").order("sort_order"),
    supabase.from("milestone_types").select("id,name,key"),
    supabase
      .from("opportunity_assignments")
      .select("user_id,assignment_role,is_primary")
      .eq("opportunity_id", id),
    supabase.from("org_users").select("user_id,role").limit(200),
    supabase.from("org_users").select("role").eq("user_id", userId).maybeSingle(),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cast = <T,>(v: unknown) => (v ?? []) as T[];

  const milestones: OppMilestone[] = (milestonesRes.data ?? []).map((m) => ({
    id: m.id as string,
    happened_at: m.happened_at as string,
    notes: m.notes as string | null,
    milestone_type_id: m.milestone_type_id as string,
    milestone_types: m.milestone_types as unknown as { id: string; name: string; key: string } | null,
  }));

  return (
    <OpportunityDetailClient
      opportunity={opp as any}
      property={(propRes.data ?? null) as any}
      account={(accountRes.data ?? null) as any}
      contact={(contactRes.data ?? null) as any}
      milestones={milestones}
      stages={cast(stagesRes.data)}
      scopeTypes={cast(scopeRes.data)}
      lostReasons={cast(lostReasonsRes.data)}
      milestoneTypes={cast(milestoneTypesRes.data)}
      assignments={cast(assignmentsRes.data)}
      orgUsers={cast(orgUsersRes.data)}
      orgId={orgId}
      userId={userId}
      userRole={meRes.data?.role ?? "rep"}
    />
  );
}
