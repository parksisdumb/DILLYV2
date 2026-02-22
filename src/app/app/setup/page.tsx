import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyOrgId } from "@/lib/supabase/get-my-org-id";

export default async function SetupPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;

  if (!user) redirect("/login");

  const orgId = await getMyOrgId(supabase, user.id);

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
      </div>
    </div>
  );
}
