import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";
import { sendInviteEmail } from "@/lib/supabase/invite";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    status?: string;
    error?: string;
    email?: string;
    password?: string;
    name?: string;
    role?: string;
  }>;
};

async function addUserAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("org_id") ?? "").trim();
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "").trim();
  const role = String(formData.get("role") ?? "rep").trim();

  const base = `/admin/orgs/${orgId}/users/new`;

  if (!firstName) {
    redirect(`${base}?error=First+name+is+required`);
  }
  if (!lastName) {
    redirect(`${base}?error=Last+name+is+required`);
  }
  if (!email) {
    redirect(`${base}?error=Email+is+required`);
  }
  if (!password || password.length < 6) {
    redirect(`${base}?error=Password+must+be+at+least+6+characters`);
  }

  // 1. Send invite email (creates auth user + sends email)
  const { data: invited, error: inviteError } = await sendInviteEmail(email, {
    firstName,
    lastName,
  });

  if (inviteError || !invited.user?.id) {
    const msg = inviteError?.message || "Failed to invite user";
    redirect(`${base}?error=${encodeURIComponent(msg)}`);
  }

  const userId = invited.user.id;
  const admin = createAdminClient();

  // 2. Set the password so the user can also log in directly
  const { error: pwError } = await admin.auth.admin.updateUserById(userId, {
    password,
  });

  if (pwError) {
    redirect(`${base}?error=${encodeURIComponent(`User created but password failed: ${pwError.message}`)}`);
  }

  // 3. Insert profile
  const fullName = `${firstName} ${lastName}`;
  const { error: profileError } = await admin.from("profiles").upsert(
    { user_id: userId, full_name: fullName },
    { onConflict: "user_id" },
  );

  if (profileError) {
    redirect(`${base}?error=${encodeURIComponent(`Profile: ${profileError.message}`)}`);
  }

  // 4. Insert org_users
  const { error: orgUserError } = await admin
    .from("org_users")
    .insert({ org_id: orgId, user_id: userId, role });

  if (orgUserError) {
    redirect(`${base}?error=${encodeURIComponent(`Org membership: ${orgUserError.message}`)}`);
  }

  redirect(
    `${base}?status=success&email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}&name=${encodeURIComponent(fullName)}&role=${encodeURIComponent(role)}`,
  );
}

export default async function AddUserPage({ params, searchParams }: Props) {
  await requireAdmin();
  const { id: orgId } = await params;
  const sp = await searchParams;
  const admin = createAdminClient();

  // Verify org exists
  const { data: org, error: orgError } = await admin
    .from("orgs")
    .select("id, name")
    .eq("id", orgId)
    .maybeSingle();

  if (orgError) throw new Error(orgError.message);
  if (!org) notFound();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://dillyv2.vercel.app";

  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:px-6">
      <Link href={`/admin/orgs/${orgId}`} className="text-sm text-slate-400 hover:text-white">
        &larr; Back to {org.name}
      </Link>

      <h1 className="mt-4 text-2xl font-bold text-white">Add User</h1>
      <p className="mt-1 text-sm text-slate-400">
        Add a new user to <span className="font-medium text-slate-300">{org.name}</span>
      </p>

      {/* Success screen */}
      {sp.status === "success" && (
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-green-800 bg-green-900/30 p-6 space-y-3">
            <div className="text-base font-semibold text-green-300">User created &amp; invite sent</div>
            <div className="space-y-1 text-sm text-green-200">
              <div><span className="text-green-400">Name:</span> {sp.name}</div>
              <div><span className="text-green-400">Email:</span> {sp.email}</div>
              <div><span className="text-green-400">Role:</span> {sp.role}</div>
              <div><span className="text-green-400">Password:</span> {sp.password}</div>
            </div>
            <p className="text-sm text-green-200/80">
              An invite email has been sent. They can also log in directly
              at {appUrl}/login with the password above.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5 space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Copy and send to the user
            </div>
            <div className="rounded-xl border border-slate-600 bg-slate-700 p-4 text-sm leading-relaxed text-slate-200">
              Your Dilly account is ready. Log in at {appUrl}/login with
              email {sp.email} and password {sp.password}
            </div>
          </div>

          <div className="flex gap-3">
            <Link
              href={`/admin/orgs/${orgId}/users/new`}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Add another user
            </Link>
            <Link
              href={`/admin/orgs/${orgId}`}
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Back to org
            </Link>
          </div>
        </div>
      )}

      {/* Error */}
      {sp.error && sp.status !== "success" && (
        <div className="mt-4 rounded-xl border border-red-800 bg-red-900/50 px-4 py-3 text-sm text-red-300">
          {sp.error}
        </div>
      )}

      {/* Form */}
      {sp.status !== "success" && (
        <form action={addUserAction} className="mt-6 space-y-4">
          <input type="hidden" name="org_id" value={orgId} />

          <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-300">First Name</label>
                <input
                  className="w-full rounded-xl border border-slate-600 bg-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  name="first_name"
                  required
                  placeholder="Jane"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-300">Last Name</label>
                <input
                  className="w-full rounded-xl border border-slate-600 bg-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  name="last_name"
                  required
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
                type="text"
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
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Create User &amp; Send Invite
          </button>
        </form>
      )}
    </div>
  );
}
