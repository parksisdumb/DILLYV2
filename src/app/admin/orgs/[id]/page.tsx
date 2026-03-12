import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function OrgDetailPage({ params }: Props) {
  await requireAdmin();
  const { id: orgId } = await params;
  const admin = createAdminClient();

  // Fetch org
  const { data: org, error: orgError } = await admin
    .from("orgs")
    .select("id, name, created_at")
    .eq("id", orgId)
    .maybeSingle();

  if (orgError) throw new Error(orgError.message);
  if (!org) notFound();

  // Fetch org users with roles
  const { data: orgUsers, error: usersError } = await admin
    .from("org_users")
    .select("user_id, role, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  if (usersError) throw new Error(usersError.message);

  // Fetch auth user emails + profile names
  const userIds = (orgUsers ?? []).map((u) => u.user_id);
  const userMap = new Map<string, { email: string; fullName: string }>();

  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", userIds);

    const profileMap = new Map<string, string>();
    for (const p of profiles ?? []) {
      if (p.full_name) profileMap.set(p.user_id, p.full_name);
    }

    const perPage = 200;
    let page = 1;
    const wantedIds = new Set(userIds);
    while (wantedIds.size > 0) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) break;
      for (const u of data.users) {
        if (u.id && wantedIds.has(u.id)) {
          userMap.set(u.id, {
            email: u.email ?? "",
            fullName: profileMap.get(u.id) ?? u.email ?? "",
          });
          wantedIds.delete(u.id);
        }
      }
      if (data.users.length < perPage) break;
      page++;
    }
  }

  const users = (orgUsers ?? []).map((ou) => ({
    userId: ou.user_id,
    role: ou.role as string,
    createdAt: ou.created_at as string,
    email: userMap.get(ou.user_id)?.email ?? "",
    fullName: userMap.get(ou.user_id)?.fullName ?? "",
  }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Link href="/admin" className="text-sm text-slate-400 hover:text-white">
        &larr; Back to dashboard
      </Link>

      {/* Org header */}
      <div className="mt-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{org.name}</h1>
          <div className="mt-0.5 text-sm text-slate-400">
            Created {new Date(org.created_at).toLocaleDateString()}
          </div>
        </div>
        <Link
          href={`/admin/orgs/${orgId}/users/new`}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Add User
        </Link>
      </div>

      {/* Users list */}
      <div className="mt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          Users ({users.length})
        </h2>

        {users.length === 0 && (
          <div className="mt-3 rounded-2xl border border-slate-700 bg-slate-800 p-6 text-center text-sm text-slate-400">
            No users yet. Add the first admin user to get started.
          </div>
        )}

        <div className="mt-3 space-y-2">
          {users.map((u) => (
            <div
              key={u.userId}
              className="flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-800 px-4 py-3"
            >
              <div>
                <div className="text-sm font-medium text-white">{u.fullName || u.email}</div>
                {u.fullName && (
                  <div className="text-xs text-slate-400">{u.email}</div>
                )}
                <div className="mt-0.5 text-xs text-slate-500">
                  Added {new Date(u.createdAt).toLocaleDateString()}
                </div>
              </div>
              <span className="rounded-lg bg-slate-700 px-2.5 py-1 text-xs font-medium capitalize text-slate-300">
                {u.role}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
