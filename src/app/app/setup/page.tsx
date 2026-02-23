import { redirect } from "next/navigation";
import { getServerAuthOrgState } from "@/lib/supabase/server-org";

export default async function SetupPage() {
  const { userId, orgId } = await getServerAuthOrgState();
  const showDevProvisionLink = process.env.NODE_ENV !== "production";

  if (!userId) redirect("/login");

  if (orgId) {
    redirect("/app");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border p-6 space-y-4">
        <h1 className="text-xl font-semibold">Organization Assignment Required</h1>
        <p className="text-sm text-gray-700">
          Your account is signed in, but it is not assigned to an organization yet.
        </p>
        <p className="text-sm text-gray-700">
          Ask your admin to invite or assign this user to the correct organization.
        </p>
        {showDevProvisionLink && (
          <a href="/dev/provision" className="text-sm underline">
            Dev: provision initial org owner
          </a>
        )}
      </div>
    </div>
  );
}
