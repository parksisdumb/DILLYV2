import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; message?: string; email?: string }>;
};

async function addUserAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("org_id") ?? "").trim();
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "").trim();
  const role = String(formData.get("role") ?? "rep").trim();

  if (!email) {
    redirect(`/admin/orgs/${orgId}?status=error&message=Email+is+required`);
  }
  if (!password) {
    redirect(`/admin/orgs/${orgId}?status=error&message=Password+is+required`);
  }

  const admin = createAdminClient();

  // Create auth user
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName },
  });

  if (createError || !created.user?.id) {
    const msg = createError?.message || "Failed to create user";
    redirect(`/admin/orgs/${orgId}?status=error&message=${encodeURIComponent(msg)}`);
  }

  const userId = created.user.id;

  // Create profile
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  if (fullName) {
    await admin.from("profiles").upsert(
      { user_id: userId, full_name: fullName },
      { onConflict: "user_id" },
    );
  }

  // Add to org
  const { error: orgUserError } = await admin
    .from("org_users")
    .insert({ org_id: orgId, user_id: userId, role });

  if (orgUserError) {
    redirect(`/admin/orgs/${orgId}?status=error&message=${encodeURIComponent(orgUserError.message)}`);
  }

  redirect(`/admin/orgs/${orgId}?status=success&email=${encodeURIComponent(email)}`);
}

export default async function OrgDetailPage({ params, searchParams }: Props) {
  const { id: orgId } = await params;
  const sp = await searchParams;
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
    .select("user_id, role")
    .eq("org_id", orgId);

  if (usersError) throw new Error(usersError.message);

  // Fetch auth user details for emails
  const userIds = (orgUsers ?? []).map((u) => u.user_id);
  const userMap = new Map<string, { email: string; fullName: string }>();

  if (userIds.length > 0) {
    // Fetch profiles for names
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", userIds);

    const profileMap = new Map<string, string>();
    for (const p of profiles ?? []) {
      if (p.full_name) profileMap.set(p.user_id, p.full_name);
    }

    // Fetch auth emails by paginating all users
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
    role: ou.role,
    email: userMap.get(ou.user_id)?.email ?? "—",
    fullName: userMap.get(ou.user_id)?.fullName ?? "—",
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
            Created {new Date(org.created_at).toLocaleDateString()} &middot; {users.length} user{users.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {/* Status messages */}
      {sp.status === "success" && (
        <div className="mt-4 rounded-xl border border-green-800 bg-green-900/30 px-4 py-3 text-sm text-green-300">
          User <span className="font-medium">{sp.email}</span> added successfully.
        </div>
      )}
      {sp.status === "error" && (
        <div className="mt-4 rounded-xl border border-red-800 bg-red-900/50 px-4 py-3 text-sm text-red-300">
          {sp.message || "Something went wrong"}
        </div>
      )}

      {/* Users list */}
      <div className="mt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Users</h2>
        <div className="mt-3 space-y-2">
          {users.map((u) => (
            <div
              key={u.userId}
              className="flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-800 px-4 py-3"
            >
              <div>
                <div className="text-sm font-medium text-white">{u.fullName}</div>
                <div className="text-xs text-slate-400">{u.email}</div>
              </div>
              <span className="rounded-lg bg-slate-700 px-2.5 py-1 text-xs font-medium capitalize text-slate-300">
                {u.role}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Add User form */}
      <div className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Add User</h2>
        <form action={addUserAction} className="mt-3 rounded-2xl border border-slate-700 bg-slate-800 p-5 space-y-4">
          <input type="hidden" name="org_id" value={orgId} />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-300">First Name</label>
              <input
                className="w-full rounded-xl border border-slate-600 bg-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                name="first_name"
                placeholder="Jane"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-300">Last Name</label>
              <input
                className="w-full rounded-xl border border-slate-600 bg-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                name="last_name"
                placeholder="Doe"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-300">Email</label>
            <input
              className="w-full rounded-xl border border-slate-600 bg-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              name="email"
              type="email"
              required
              placeholder="jane@company.com"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-300">Password</label>
            <input
              className="w-full rounded-xl border border-slate-600 bg-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              name="password"
              type="password"
              required
              placeholder="Minimum 6 characters"
              minLength={6}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-300">Role</label>
            <select
              name="role"
              defaultValue="rep"
              className="w-full rounded-xl border border-slate-600 bg-slate-700 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="rep">Rep</option>
            </select>
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Add User
          </button>
        </form>
      </div>
    </div>
  );
}
