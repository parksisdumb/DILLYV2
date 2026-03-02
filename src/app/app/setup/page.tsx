import { redirect } from "next/navigation";
import { getServerAuthOrgState } from "@/lib/supabase/server-org";

export default async function SetupPage() {
  const { supabase, userId } = await getServerAuthOrgState();

  if (!userId) redirect("/login");

  const { data: orgUser, error: orgUserError } = await supabase
    .from("org_users")
    .select("org_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (orgUserError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Setup</h1>
        <section className="max-w-xl rounded-2xl border border-red-200 bg-red-50 p-6">
          <h2 className="text-base font-semibold text-red-900">Setup Error</h2>
          <p className="mt-2 text-sm text-red-700">{orgUserError.message}</p>
          <a href="/login" className="mt-4 inline-block text-sm font-medium underline">
            Back to login
          </a>
        </section>
      </div>
    );
  }

  if (orgUser?.org_id) {
    redirect("/app/today");
  }

  const { data: orgId, error: bootstrapError } = await supabase.rpc("rpc_bootstrap_org", {
    p_org_name: "Dilly Dev Org",
  });

  if (bootstrapError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Setup</h1>
        <section className="max-w-xl rounded-2xl border border-red-200 bg-red-50 p-6">
          <h2 className="text-base font-semibold text-red-900">Bootstrap Error</h2>
          <p className="mt-2 text-sm text-red-700">{bootstrapError.message}</p>
          <a href="/app/setup" className="mt-4 inline-block text-sm font-medium underline">
            Retry setup
          </a>
        </section>
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Setup</h1>
        <section className="max-w-xl rounded-2xl border border-red-200 bg-red-50 p-6">
          <h2 className="text-base font-semibold text-red-900">Bootstrap Error</h2>
          <p className="text-sm text-red-700">
            Bootstrap returned no org id. Please retry.
          </p>
          <a href="/app/setup" className="mt-4 inline-block text-sm font-medium underline">
            Retry setup
          </a>
        </section>
      </div>
    );
  }

  redirect("/app/today");
}
