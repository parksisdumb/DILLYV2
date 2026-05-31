import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";
import { sendInviteEmail } from "@/lib/supabase/invite";
import AddUserForm from "./add-user-form";
import ClearCreatedPasswordCookie from "./clear-created-password-cookie";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    status?: string;
    mode?: string;
    error?: string;
    email?: string;
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
  // Invite mode when the toggle is checked, or no password was provided.
  const inviteMode = formData.get("send_invite") === "on" || !password;

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
  if (!inviteMode && password.length < 6) {
    redirect(`${base}?error=Password+must+be+at+least+6+characters`);
  }

  const admin = createAdminClient();
  const fullName = `${firstName} ${lastName}`;
  let userId: string;

  if (inviteMode) {
    // OPTION B — send an invite email; the user sets their own password
    // via the emailed link (do not pre-confirm or set a password here).
    const { data: invited, error: inviteError } = await sendInviteEmail(email, {
      firstName,
      lastName,
      confirmEmail: false,
    });

    if (inviteError || !invited.user?.id) {
      const msg = inviteError?.message || "Failed to send invite";
      redirect(`${base}?error=${encodeURIComponent(msg)}`);
    }

    userId = invited.user.id;
  } else {
    // OPTION A — create the user directly with the admin-chosen password
    // (no email sent; the admin shares the credentials manually).
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName, full_name: fullName },
    });

    if (createError || !created.user?.id) {
      const msg = createError?.message || "Failed to create user";
      redirect(`${base}?error=${encodeURIComponent(msg)}`);
    }

    userId = created.user.id;
  }

  // Insert profile
  const { error: profileError } = await admin.from("profiles").upsert(
    { user_id: userId, full_name: fullName },
    { onConflict: "user_id" },
  );

  if (profileError) {
    redirect(`${base}?error=${encodeURIComponent(`Profile: ${profileError.message}`)}`);
  }

  // Insert org_users
  const { error: orgUserError } = await admin
    .from("org_users")
    .insert({ org_id: orgId, user_id: userId, role });

  if (orgUserError) {
    redirect(`${base}?error=${encodeURIComponent(`Org membership: ${orgUserError.message}`)}`);
  }

  if (inviteMode) {
    redirect(
      `${base}?status=success&mode=invite&email=${encodeURIComponent(email)}&name=${encodeURIComponent(fullName)}&role=${encodeURIComponent(role)}`,
    );
  }

  // Password mode — stash the password in a short-lived, httpOnly cookie
  // instead of the URL (keeps it out of browser history and server logs).
  // The success screen reads it once, then clears it.
  const cookieStore = await cookies();
  cookieStore.set("admin_created_password", password, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60, // expires in 60 seconds
    path: "/",
  });

  redirect(
    `${base}?status=success&mode=password&email=${encodeURIComponent(email)}&name=${encodeURIComponent(fullName)}&role=${encodeURIComponent(role)}`,
  );
}

// Clears the one-time password cookie. Cookie mutations aren't allowed during
// a Server Component render, so the success screen fires this from the client
// on mount (see ClearCreatedPasswordCookie).
async function clearCreatedPasswordCookie() {
  "use server";
  const cookieStore = await cookies();
  cookieStore.delete("admin_created_password");
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

  // Read the one-time password cookie (set by the action in password mode).
  // It is cleared on the client right after this renders.
  const cookieStore = await cookies();
  const createdPassword = cookieStore.get("admin_created_password")?.value ?? "";

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
          {sp.mode === "invite" ? (
            /* OPTION B — invite email sent */
            <div className="rounded-2xl border border-green-800 bg-green-900/30 p-6 space-y-3">
              <div className="text-base font-semibold text-green-300">Invitation sent</div>
              <div className="space-y-1 text-sm text-green-200">
                <div><span className="text-green-400">Name:</span> {sp.name}</div>
                <div><span className="text-green-400">Email:</span> {sp.email}</div>
                <div><span className="text-green-400">Role:</span> {sp.role}</div>
              </div>
              <p className="text-sm text-green-200/80">
                Invitation sent to {sp.email}. They will set their own password.
              </p>
            </div>
          ) : (
            /* OPTION A — password set; show credentials to copy and share */
            <>
              <div className="rounded-2xl border border-green-800 bg-green-900/30 p-6 space-y-3">
                <div className="text-base font-semibold text-green-300">User created</div>
                <div className="space-y-1 text-sm text-green-200">
                  <div><span className="text-green-400">Name:</span> {sp.name}</div>
                  <div><span className="text-green-400">Email:</span> {sp.email}</div>
                  <div><span className="text-green-400">Role:</span> {sp.role}</div>
                </div>
                <p className="text-sm text-green-200/80">
                  Share these credentials with {sp.name}.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5 space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Copy and send to the user
                </div>
                <div className="rounded-xl border border-slate-600 bg-slate-700 p-4 text-sm leading-relaxed text-slate-200 space-y-1">
                  <div><span className="text-slate-400">Email:</span> {sp.email}</div>
                  <div><span className="text-slate-400">Password:</span> {createdPassword}</div>
                </div>
                <p className="text-xs text-slate-500">
                  Shown once — copy it now. It is not stored and won&apos;t appear if you reload.
                </p>
              </div>

              {/* Clears the httpOnly password cookie immediately after render. */}
              <ClearCreatedPasswordCookie clear={clearCreatedPasswordCookie} />
            </>
          )}

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
        <AddUserForm action={addUserAction} orgId={orgId} />
      )}
    </div>
  );
}
