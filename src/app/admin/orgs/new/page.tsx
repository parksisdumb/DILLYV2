import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type Props = {
  searchParams: Promise<{ error?: string }>;
};

async function createOrgAction(formData: FormData) {
  "use server";

  const orgName = String(formData.get("org_name") ?? "").trim();

  if (!orgName) {
    redirect("/admin/orgs/new?error=Organization+name+is+required");
  }

  const admin = createAdminClient();

  const { data: org, error: orgError } = await admin
    .from("orgs")
    .insert({ name: orgName })
    .select("id")
    .single();

  if (orgError || !org) {
    const msg = orgError?.message || "Failed to create org";
    redirect(`/admin/orgs/new?error=${encodeURIComponent(msg)}`);
  }

  redirect(`/admin/orgs/${org.id}`);
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
        After creating the org, you can add the first admin user.
      </p>

      {params.error && (
        <div className="mt-4 rounded-xl border border-red-800 bg-red-900/50 px-4 py-3 text-sm text-red-300">
          {params.error}
        </div>
      )}

      <form action={createOrgAction} className="mt-6 space-y-4">
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-300">Org Name</label>
            <input
              className="w-full rounded-xl border border-slate-600 bg-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              name="org_name"
              required
              placeholder="e.g. Apex Roofing Solutions"
              autoFocus
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
    </div>
  );
}
