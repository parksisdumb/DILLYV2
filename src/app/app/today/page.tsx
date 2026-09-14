import { requireServerOrgContext } from "@/lib/supabase/server-org";
import TodayClient from "@/app/app/today/today-client";
import { getColdAccounts } from "@/lib/cold-accounts";

export default async function TodayPage() {
  const { supabase, userId } = await requireServerOrgContext();

  // The home screen (and the root, which redirects here) must never hard-500 on a
  // transient data blip. These server reads are pre-computed to spare Today's
  // client waterfall, but a rejected fetch must degrade to an empty state, not an
  // application error. Auth (requireServerOrgContext) stays outside the guard so a
  // real auth failure still redirects to /login correctly.
  let coldAccounts: Awaited<ReturnType<typeof getColdAccounts>> = [];
  let hasEmailConnection = false;
  try {
    coldAccounts = await getColdAccounts(supabase, { ownerUserId: userId });
    // Tolerant of the email_connections table not existing (no row → banner shows).
    const { data: conn } = await supabase
      .from("email_connections")
      .select("id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    hasEmailConnection = Boolean(conn);
  } catch (err) {
    console.error("[today] server-side data fetch failed — rendering degraded home:", err);
  }

  return <TodayClient userId={userId} coldAccounts={coldAccounts} hasEmailConnection={hasEmailConnection} />;
}
