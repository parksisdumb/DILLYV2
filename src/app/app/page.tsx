import { redirect } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";

export default async function AppEntry() {
  const { supabase, userId } = await requireServerOrgContext();

  const { data: orgUser } = await supabase
    .from("org_users")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  const role = orgUser?.role;
  if (role === "manager" || role === "admin") {
    redirect("/app/manager");
  }

  redirect("/app/today");
}
