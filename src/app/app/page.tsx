import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AppEntry() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) redirect("/login");

  // If the user has a membership, go to Today. Otherwise, go to org setup.
  const { data: membership } = await supabase
    .from("memberships")
    .select("org_id")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (!membership?.org_id) redirect("/app/setup");

  redirect("/app/today");
}
