import { redirect } from "next/navigation";
import { getServerAuthOrgState } from "@/lib/supabase/server-org";

type SetupPageProps = {
  searchParams: Promise<{ error?: string }>;
};

async function bootstrapAction(formData: FormData) {
  "use server";

  const orgName = String(formData.get("org_name") ?? "").trim();
  if (!orgName) redirect("/app/setup?error=Organization+name+is+required");

  const { supabase, userId } = await getServerAuthOrgState();
  if (!userId) redirect("/login");

  const { error } = await supabase.rpc("rpc_bootstrap_org", { p_org_name: orgName });
  if (error) redirect(`/app/setup?error=${encodeURIComponent(error.message)}`);

  redirect("/app/today");
}

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const params = await searchParams;
  const { supabase, userId } = await getServerAuthOrgState();

  if (!userId) redirect("/login");

  const { data: orgUser } = await supabase
    .from("org_users")
    .select("org_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (orgUser?.org_id) redirect("/app/today");

  const errorMessage = params.error ?? null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="mb-8 text-center">
          <div className="text-2xl font-bold tracking-tight text-blue-600">Dilly</div>
        </div>

        <div className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">
            Welcome! Let&apos;s set up your workspace.
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            You&apos;ll use this to track your team&apos;s activity and pipeline.
          </p>

          <form action={bootstrapAction} className="mt-6 space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="org_name" className="text-sm font-medium text-slate-700">
                Organization Name <span className="text-red-500">*</span>
              </label>
              <input
                id="org_name"
                name="org_name"
                type="text"
                placeholder='e.g. "Acme Roofing"'
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
                autoFocus
              />
              <p className="text-xs text-slate-400">Your company name or team name.</p>
            </div>

            {errorMessage && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {errorMessage}
              </p>
            )}

            <button
              type="submit"
              className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Create Organization
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
