import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyOrgId } from "@/lib/supabase/get-my-org-id";

const DEFAULT_ORG_NAME = "Dilly Dev Org";

export default async function SetupPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;

  if (!user) redirect("/login");

  const orgId = await getMyOrgId(supabase, user.id);

  if (orgId) {
    redirect("/app");
  }

  const { error: bootstrapError } = await supabase.rpc("rpc_bootstrap_org", {
    p_org_name: DEFAULT_ORG_NAME,
  });

  if (bootstrapError) {
    throw new Error(bootstrapError.message);
  }

  redirect("/app");
}
