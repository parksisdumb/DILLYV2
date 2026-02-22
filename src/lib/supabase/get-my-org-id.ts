import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getMyOrgId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data: orgUser, error: orgUserError } = await supabase
    .from("org_users")
    .select("org_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (orgUserError) {
    throw new Error(orgUserError.message);
  }

  if (orgUser?.org_id) {
    return orgUser.org_id;
  }

  const { data: membership, error: membershipError } = await supabase
    .from("memberships")
    .select("org_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError) {
    throw new Error(membershipError.message);
  }

  return membership?.org_id ?? null;
}
