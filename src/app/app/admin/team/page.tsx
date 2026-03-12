import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import { sendInviteEmail } from "@/lib/supabase/invite";

type TeamPageSearchParams = {
  status?: string;
  message?: string;
};

type TeamPageProps = {
  searchParams: Promise<TeamPageSearchParams>;
};

function safeNextPath(path: string) {
  return path.startsWith("/") ? path : "/app/admin/team";
}

async function createInviteAction(formData: FormData) {
  "use server";

  const { supabase, userId } = await requireServerOrgContext();

  const { data: orgUser, error: orgUserError } = await supabase
    .from("org_users")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (orgUserError) {
    redirect(
      `/app/admin/team?status=error&message=${encodeURIComponent(orgUserError.message)}`,
    );
  }

  const inviterRole = orgUser?.role ?? "";
  if (inviterRole !== "admin" && inviterRole !== "manager") {
    redirect("/app");
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const requestedRole = String(formData.get("role") ?? "rep").trim().toLowerCase();
  const role = inviterRole === "manager" ? "rep" : requestedRole;
  const note = String(formData.get("note") ?? "").trim();

  const { data: invite, error } = await supabase.rpc("rpc_invite_user", {
    p_email: email,
    p_role: role,
    p_note: note || null,
  });

  if (error) {
    redirect(`/app/admin/team?status=error&message=${encodeURIComponent(error.message)}`);
  }

  // Send invite email via Supabase (creates auth user if needed)
  const token = invite?.token;
  const redirectPath = token ? `/invite/accept/${token}` : "/auth/set-password";
  const { error: emailError } = await sendInviteEmail(email, { redirectPath });

  // If user already exists in auth, the invite email will fail — that's OK,
  // the org_invite record was still created and the link is shown on screen.
  if (emailError && !emailError.message?.includes("already been registered")) {
    redirect(
      `/app/admin/team?status=error&message=${encodeURIComponent(`Invite created but email failed: ${emailError.message}`)}`,
    );
  }

  revalidatePath("/app/admin/team");
  redirect("/app/admin/team?status=success");
}

export default async function TeamPage({ searchParams }: TeamPageProps) {
  const { supabase, userId, orgId } = await requireServerOrgContext();
  const params = await searchParams;

  const { data: orgUser, error: orgUserError } = await supabase
    .from("org_users")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (orgUserError) throw new Error(orgUserError.message);

  const inviterRole = orgUser?.role ?? "";
  if (inviterRole !== "admin" && inviterRole !== "manager") {
    redirect("/app");
  }

  const { data: invites, error: invitesError } = await supabase
    .from("org_invites")
    .select("id, email, role, token, created_at, expires_at, accepted_at")
    .eq("org_id", orgId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(100);

  if (invitesError) throw new Error(invitesError.message);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const roles = inviterRole === "manager" ? ["rep"] : ["rep", "manager", "admin"];
  const status = params.status;
  const message = params.message;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Team</h1>
        <p className="text-sm text-slate-600">
          Invite users to join your organization and assign a role.
        </p>
      </div>

      {status === "success" && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Invite sent. They&apos;ll receive an email with a link to join.
        </p>
      )}
      {status === "error" && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {message || "Invite failed."}
        </p>
      )}

      <form
        action={createInviteAction}
        className="max-w-xl space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">Email</label>
          <input
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
            name="email"
            type="email"
            required
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">Role</label>
          <select
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
            name="role"
            defaultValue="rep"
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">Note (optional)</label>
          <input
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
            name="note"
            type="text"
          />
        </div>
        <button className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Send invite
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Invites</h2>
        {!invites?.length ? (
          <p className="mt-2 text-sm text-slate-600">No invites yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {invites.map((invite) => {
              const link = safeNextPath(`/invite/accept/${invite.token}`);
              const fullLink = `${appUrl}${link}`;
              return (
                <li
                  key={invite.id}
                  className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="text-sm font-medium text-slate-900">
                    {invite.email} ({invite.role})
                  </div>
                  <div className="text-xs text-slate-600">
                    Created: {new Date(invite.created_at).toLocaleString()}
                  </div>
                  <div className="text-xs text-slate-600">
                    Expires: {new Date(invite.expires_at).toLocaleString()}
                  </div>
                  <div className="text-xs text-slate-600">
                    Status: {invite.accepted_at ? "accepted" : "pending"}
                  </div>
                  {!invite.accepted_at && (
                    <div className="break-all text-xs text-slate-700">
                      Accept link:{" "}
                      <a href={fullLink} className="font-medium underline">
                        {fullLink}
                      </a>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
