import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";

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

  const { error } = await supabase.rpc("rpc_invite_user", {
    p_email: email,
    p_role: role,
    p_note: note || null,
  });

  if (error) {
    redirect(`/app/admin/team?status=error&message=${encodeURIComponent(error.message)}`);
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
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-gray-600">
          Invite users to join your organization and assign a role.
        </p>
      </div>

      {status === "success" && (
        <p className="text-sm text-green-700">Invite created.</p>
      )}
      {status === "error" && (
        <p className="text-sm text-red-700">{message || "Invite failed."}</p>
      )}

      <form action={createInviteAction} className="rounded-2xl border p-4 space-y-3 max-w-xl">
        <div className="space-y-1">
          <label className="text-sm">Email</label>
          <input
            className="w-full rounded-md border px-3 py-2"
            name="email"
            type="email"
            required
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm">Role</label>
          <select className="w-full rounded-md border px-3 py-2" name="role" defaultValue="rep">
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm">Note (optional)</label>
          <input className="w-full rounded-md border px-3 py-2" name="note" type="text" />
        </div>
        <button className="rounded-md border px-3 py-2">Create invite</button>
      </form>

      <div className="rounded-2xl border p-4">
        <h2 className="text-lg font-semibold">Invites</h2>
        {!invites?.length ? (
          <p className="text-sm mt-2">No invites yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {invites.map((invite) => {
              const link = safeNextPath(`/invite/accept/${invite.token}`);
              const fullLink = `${appUrl}${link}`;
              return (
                <li key={invite.id} className="rounded-lg border p-3 space-y-1">
                  <div className="text-sm font-medium">
                    {invite.email} ({invite.role})
                  </div>
                  <div className="text-xs text-gray-600">
                    Created: {new Date(invite.created_at).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-600">
                    Expires: {new Date(invite.expires_at).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-600">
                    Status: {invite.accepted_at ? "accepted" : "pending"}
                  </div>
                  {!invite.accepted_at && (
                    <div className="text-xs break-all">
                      Accept link:{" "}
                      <a href={fullLink} className="underline">
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

