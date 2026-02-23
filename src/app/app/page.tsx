import { redirect } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";

export default async function AppEntry() {
  await requireServerOrgContext();

  redirect("/app/today");
}
