import { redirect } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import IcpSetupClient from "./icp-setup-client";

export default async function IcpSetupPage() {
  const { supabase, userId, orgId } = await requireServerOrgContext();

  const { data: orgUser } = await supabase
    .from("org_users")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (!orgUser || !["manager", "admin"].includes(orgUser.role)) {
    redirect("/app");
  }

  // Pre-fill states from territory_regions
  const { data: territories } = await supabase.from("territories").select("id");
  const tIds = (territories ?? []).map((t) => t.id as string);

  let prefillStates: string[] = [];
  if (tIds.length > 0) {
    const { data: regions } = await supabase
      .from("territory_regions")
      .select("state")
      .in("territory_id", tIds);
    prefillStates = [...new Set((regions ?? []).map((r) => (r.state as string).toUpperCase()))];
  }

  return <IcpSetupClient orgId={orgId} userId={userId} prefillStates={prefillStates} />;
}
