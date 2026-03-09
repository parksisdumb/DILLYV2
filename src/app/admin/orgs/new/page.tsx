import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

type Props = {
  searchParams: Promise<{ status?: string; message?: string; orgName?: string; email?: string }>;
};

async function createOrgAction(formData: FormData) {
  "use server";

  const orgName = String(formData.get("org_name") ?? "").trim();
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "").trim();

  if (!orgName) {
    redirect("/admin/orgs/new?status=error&message=Organization+name+is+required");
  }
  if (!email) {
    redirect("/admin/orgs/new?status=error&message=Admin+email+is+required");
  }
  if (!password) {
    redirect("/admin/orgs/new?status=error&message=Admin+password+is+required");
  }

  const admin = createAdminClient();

  // 1. Create Supabase auth user
  const { data: created, error: createUserError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      first_name: firstName,
      last_name: lastName,
    },
  });

  if (createUserError || !created.user?.id) {
    const msg = createUserError?.message || "Failed to create user";
    redirect(`/admin/orgs/new?status=error&message=${encodeURIComponent(msg)}`);
  }

  const userId = created.user.id;

  // 2. Create a profile row
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  if (fullName) {
    await admin.from("profiles").upsert(
      { user_id: userId, full_name: fullName },
      { onConflict: "user_id" },
    );
  }

  // 3. Insert org
  const { data: org, error: orgError } = await admin
    .from("orgs")
    .insert({ name: orgName, created_by: userId })
    .select("id")
    .single();

  if (orgError || !org) {
    const msg = orgError?.message || "Failed to create org";
    redirect(`/admin/orgs/new?status=error&message=${encodeURIComponent(msg)}`);
  }

  // 4. Insert org_user with admin role
  const { error: orgUserError } = await admin
    .from("org_users")
    .insert({ org_id: org.id, user_id: userId, role: "admin" });

  if (orgUserError) {
    redirect(`/admin/orgs/new?status=error&message=${encodeURIComponent(orgUserError.message)}`);
  }

  redirect(
    `/admin/orgs/new?status=success&orgName=${encodeURIComponent(orgName)}&email=${encodeURIComponent(email)}`,
  );
}

export default async function NewOrgPage({ searchParams }: Props) {
  const params = await searchParams;

  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:px-6">
      <Link href="/admin" className="text-sm text-slate-400 hover:text-white">
        &larr; Back to dashboard
      </Link>

      <h1 className="mt-4 text-2xl font-bold text-white">Create Organization</h1>
      <p className="mt-1 text-sm text-slate-400">
        This creates a new org, a Supabase auth user, and assigns them as the org admin.
      </p>

      {params.status === "success" && (
        <div className="mt-6 rounded-2xl border border-green-800 bg-green-900/30 p-6 space-y-3">
          <div className="text-base font-semibold text-green-300">Organization created</div>
          <div className="space-y-1 text-sm text-green-200">
            <div><span className="text-green-400">Org:</span> {params.orgName}</div>
            <div><span className="text-green-400">Admin email:</span> {params.email}</div>
          </div>
          <div className="rounded-xl border border-green-800 bg-green-900/50 px-3 py-2 text-sm text-green-300">
            Send the client their login URL and credentials. They can log in and start using Dilly immediately.
          </div>
          <div className="flex gap-3 pt-2">
            <Link
              href="/admin/orgs/new"
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Create another
            </Link>
            <Link
              href="/admin"
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      )}

      {params.status === "error" && (
        <div className="mt-6 rounded-xl border border-red-800 bg-red-900/50 px-4 py-3 text-sm text-red-300">
          {params.message || "Something went wrong"}
        </div>
      )}

      {params.status !== "success" && (
        <form action={createOrgAction} className="mt-6 space-y-4">
          <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5 space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Organization</h2>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-300">Org Name</label>
              <input
                className="w-full rounded-xl border border-slate-600 bg-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                name="org_name"
                required
                placeholder="e.g. Apex Roofing Solutions"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5 space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Admin User</h2>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-300">First Name</label>
                <input
                  className="w-full rounded-xl border border-slate-600 bg-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  name="first_name"
                  placeholder="John"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-300">Last Name</label>
                <input
                  className="w-full rounded-xl border border-slate-600 bg-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  name="last_name"
                  placeholder="Smith"
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
                placeholder="john@apexroofing.com"
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
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Create Organization
          </button>
        </form>
      )}
    </div>
  );
}
