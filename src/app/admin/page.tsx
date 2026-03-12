import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
export default async function AdminDashboard() {
  const admin = createAdminClient();

  const { data: orgs, error: orgsError } = await admin
    .from("orgs")
    .select("id, name, created_at")
    .order("created_at", { ascending: false });

  if (orgsError) throw new Error(orgsError.message);

  const { data: orgUserCounts, error: countsError } = await admin
    .from("org_users")
    .select("org_id");

  if (countsError) throw new Error(countsError.message);

  const countMap = new Map<string, number>();
  for (const row of orgUserCounts ?? []) {
    countMap.set(row.org_id, (countMap.get(row.org_id) ?? 0) + 1);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Organizations</h1>
        <Link
          href="/admin/orgs/new"
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Create New Org
        </Link>
      </div>

      <div className="mt-6 space-y-3">
        {(!orgs || orgs.length === 0) && (
          <div className="rounded-2xl border border-slate-700 bg-slate-800 p-6 text-center text-sm text-slate-400">
            No organizations yet. Create one to get started.
          </div>
        )}

        {orgs?.map((org) => (
          <Link
            key={org.id}
            href={`/admin/orgs/${org.id}`}
            className="block rounded-2xl border border-slate-700 bg-slate-800 p-4 transition-colors hover:border-slate-600"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-base font-semibold text-white">{org.name}</div>
                <div className="mt-0.5 text-sm text-slate-400">
                  Created {new Date(org.created_at).toLocaleDateString()}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold text-white">
                  {countMap.get(org.id) ?? 0}
                </div>
                <div className="text-xs text-slate-400">users</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
