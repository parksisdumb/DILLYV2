import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getServerAuthOrgState } from "@/lib/supabase/server-org";
import AppShell from "@/app/app/_components/app-shell";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { supabase, userId, orgId } = await getServerAuthOrgState();
  if (!userId) redirect("/login");

  // Guard: authenticated users with no org must complete setup first
  if (!orgId) {
    const hdrs = await headers();
    const pathname = hdrs.get("x-invoke-path") ?? "";
    if (!pathname.startsWith("/app/setup")) {
      redirect("/app/setup");
    }
  }

  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email ?? "";

  let fullName = email;
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (profile?.full_name) fullName = profile.full_name;

  let orgName = "No Organization";
  let orgRole: string | null = null;

  if (orgId) {
    const { data: org } = await supabase
      .from("orgs")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    if (org?.name) orgName = org.name;

    const { data: orgUser } = await supabase
      .from("org_users")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    orgRole = orgUser?.role ?? null;
  }

  async function signOutAction() {
    "use server";
    const serverSupabase = await createClient();
    await serverSupabase.auth.signOut();
    redirect("/login");
  }

  return (
    <AppShell
      orgName={orgName}
      orgRole={orgRole}
      fullName={fullName}
      email={email}
      hasOrg={!!orgId}
      signOutAction={signOutAction}
    >
      {children}
    </AppShell>
  );
}
