import { requireServerOrgContext } from "@/lib/supabase/server-org";
import TodayClient from "@/app/app/today/today-client";

export default async function TodayPage() {
  const { userId } = await requireServerOrgContext();

  return <TodayClient userId={userId} />;
}
