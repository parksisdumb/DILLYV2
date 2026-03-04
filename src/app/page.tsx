import { redirect } from "next/navigation";
import { getServerAuthOrgState } from "@/lib/supabase/server-org";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const { userId } = await getServerAuthOrgState();
  if (userId) redirect("/app/today");
  redirect("/login");
}
