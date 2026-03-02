import { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerAuthOrgState } from "@/lib/supabase/server-org";
import SidebarNav, { type SidebarNavItem } from "@/app/app/_components/sidebar-nav";

type AppLayoutProps = {
  children: ReactNode;
};

export default async function AppLayout({ children }: AppLayoutProps) {
  const { supabase, userId, orgId } = await getServerAuthOrgState();
  if (!userId) redirect("/login");

  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email ?? "Signed In";

  let fullName = email;
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (profile?.full_name) {
    fullName = profile.full_name;
  }

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

  const canSeeAdmin = orgRole === "admin" || orgRole === "manager";

  const navItems: SidebarNavItem[] = [
    { href: "/app/today", label: "Today" },
    { href: "/app/accounts", label: "Accounts" },
    { href: "/app/properties", label: "Properties" },
    { href: "/app/contacts", label: "Contacts" },
    { href: "/app/opportunities", label: "Opportunities" },
  ];

  if (canSeeAdmin) {
    navItems.push({ href: "/app/admin/team", label: "Admin / Team" });
    navItems.push({ href: "/app/admin/kpis", label: "Admin / KPIs" });
  }

  if (!orgId) {
    navItems.push({ href: "/app/setup", label: "Setup" });
  }

  async function signOutAction() {
    "use server";
    const serverSupabase = await createClient();
    await serverSupabase.auth.signOut();
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 border-r border-slate-200 bg-white p-4 md:block">
          <div className="mb-6">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Dilly
            </div>
            <div className="mt-1 text-sm font-medium text-slate-900">{orgName}</div>
            <div className="text-xs text-slate-500">{orgRole ?? "member"}</div>
          </div>
          <SidebarNav items={navItems} />
        </aside>

        <div className="flex min-h-screen flex-1 flex-col">
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Organization
                </div>
                <div className="text-sm font-semibold text-slate-900">{orgName}</div>
              </div>

              <details className="relative">
                <summary className="cursor-pointer list-none rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  {fullName}
                </summary>
                <div className="absolute right-0 z-10 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                  <div className="text-xs text-slate-500">{email}</div>
                  <div className="text-xs text-slate-500">{orgRole ?? "member"}</div>
                  <form action={signOutAction} className="mt-3">
                    <button
                      type="submit"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Sign out
                    </button>
                  </form>
                </div>
              </details>
            </div>

            <div className="border-t border-slate-200 px-4 py-2 md:hidden">
              <div className="flex gap-2 overflow-x-auto">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="whitespace-nowrap rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </header>

          <main className="flex-1">
            <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
