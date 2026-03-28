import { redirect } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import ReviewClient from "./review-client";

export type ReviewProspect = {
  id: string;
  company_name: string;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  source_detail: string | null;
  confidence_score: number | null;
  created_at: string;
};

export type OrgRep = {
  user_id: string;
  full_name: string | null;
  email: string | null;
};

export default async function ProspectReviewPage() {
  const { supabase, userId, orgId } = await requireServerOrgContext();

  // Role gate
  const { data: orgUser } = await supabase
    .from("org_users")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (!orgUser || !["manager", "admin"].includes(orgUser.role)) {
    redirect("/app");
  }

  // Fetch prospects that have NO suggested_outreach record yet (unassigned)
  // Step 1: Get all prospect IDs that already have a suggested_outreach record
  const { data: assignedRows } = await supabase
    .from("suggested_outreach")
    .select("prospect_id");

  const assignedIds = new Set(
    (assignedRows ?? []).map((r) => r.prospect_id as string)
  );

  // Step 2: Get all agent-sourced prospects for this org
  const { data: allProspects } = await supabase
    .from("prospects")
    .select(
      "id,company_name,address_line1,city,state,source_detail,confidence_score,created_at"
    )
    .eq("source", "agent")
    .order("created_at", { ascending: false })
    .limit(500);

  // Step 3: Filter to unassigned only
  const unassigned: ReviewProspect[] = (allProspects ?? [])
    .filter((p) => !assignedIds.has(p.id as string))
    .map((p) => ({
      id: p.id as string,
      company_name: p.company_name as string,
      address_line1: p.address_line1 as string | null,
      city: p.city as string | null,
      state: p.state as string | null,
      source_detail: p.source_detail as string | null,
      confidence_score: p.confidence_score as number | null,
      created_at: p.created_at as string,
    }));

  // Get reps in this org
  const { data: orgUsers } = await supabase
    .from("org_users")
    .select("user_id,full_name,email,role")
    .order("full_name");

  const reps: OrgRep[] = (orgUsers ?? [])
    .filter((u) => u.role === "rep")
    .map((u) => ({
      user_id: u.user_id as string,
      full_name: u.full_name as string | null,
      email: u.email as string | null,
    }));

  return (
    <ReviewClient
      prospects={unassigned}
      reps={reps}
      orgId={orgId}
      managerId={userId}
    />
  );
}
