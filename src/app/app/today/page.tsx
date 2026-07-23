import { requireServerOrgContext } from "@/lib/supabase/server-org";
import TodayClient from "@/app/app/today/today-client";
import { getColdAccounts } from "@/lib/cold-accounts";

export default async function TodayPage() {
  const { supabase, userId } = await requireServerOrgContext();

  // Computed server-side (batch queries) so it doesn't add to Today's client
  // fetch waterfall. Scoped to this rep's own accounts.
  const coldAccounts = await getColdAccounts(supabase, { ownerUserId: userId });

  return <TodayClient userId={userId} coldAccounts={coldAccounts} />;
}
