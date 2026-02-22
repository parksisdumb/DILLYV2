import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyOrgId } from "@/lib/supabase/get-my-org-id";

export default async function AppEntry() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) redirect("/login");

  const orgId = await getMyOrgId(supabase, data.user.id);

  if (!orgId) redirect("/app/setup");

  redirect("/app/today");
}
