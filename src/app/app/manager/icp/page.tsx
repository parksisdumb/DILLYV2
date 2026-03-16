import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireServerOrgContext } from "@/lib/supabase/server-org";

async function createProfileAction(formData: FormData) {
  "use server";

  const { supabase, userId, orgId } = await requireServerOrgContext();

  const { data: orgUser } = await supabase
    .from("org_users")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (!orgUser || !["manager", "admin"].includes(orgUser.role)) {
    redirect("/app");
  }

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const territoryId = String(formData.get("territory_id") ?? "").trim();

  if (!name) {
    redirect("/app/manager/icp?error=Name+is+required");
  }

  const { data, error } = await supabase
    .from("icp_profiles")
    .insert({
      org_id: orgId,
      name,
      description: description || null,
      territory_id: territoryId || null,
      created_by: userId,
    })
    .select("id")
    .single();

  if (error) {
    redirect(
      `/app/manager/icp?error=${encodeURIComponent(error.message)}`,
    );
  }

  revalidatePath("/app/manager/icp");
  redirect(`/app/manager/icp/${data.id}`);
}

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function ICPListPage({ searchParams }: PageProps) {
  const { supabase, userId } = await requireServerOrgContext();
  const sp = await searchParams;

  // Role gate
  const { data: orgUser } = await supabase
    .from("org_users")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (!orgUser || !["manager", "admin"].includes(orgUser.role)) {
    redirect("/app");
  }

  // Fetch profiles with criteria counts
  const [profilesResult, criteriaResult, territoriesResult] =
    await Promise.all([
      supabase
        .from("icp_profiles")
        .select("id, name, description, active, territory_id, created_at")
        .order("name"),
      supabase.from("icp_criteria").select("icp_profile_id"),
      supabase
        .from("territories")
        .select("id, name")
        .order("name"),
    ]);

  const profiles = profilesResult.data ?? [];
  const criteria = criteriaResult.data ?? [];
  const territories = territoriesResult.data ?? [];

  const criteriaCounts = new Map<string, number>();
  for (const c of criteria) {
    criteriaCounts.set(
      c.icp_profile_id,
      (criteriaCounts.get(c.icp_profile_id) ?? 0) + 1,
    );
  }

  const territoryMap = new Map<string, string>();
  for (const t of territories) {
    territoryMap.set(t.id, t.name);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          ICP Profiles
        </h1>
        <p className="text-sm text-slate-600">
          Define your Ideal Customer Profile to focus rep outreach on the
          highest-value targets.
        </p>
      </div>

      {sp.error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {sp.error}
        </p>
      )}

      {/* Create form */}
      <form
        action={createProfileAction}
        className="max-w-xl space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">
            Profile Name
          </label>
          <input
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
            name="name"
            required
            placeholder="e.g. Large Flat-Roof Owners"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">
            Description (optional)
          </label>
          <input
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
            name="description"
            placeholder="Brief description of this ICP"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">
            Territory (optional)
          </label>
          <select
            name="territory_id"
            defaultValue=""
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
          >
            <option value="">No territory</option>
            {territories.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          Create Profile
        </button>
      </form>

      {/* Profile list */}
      <div className="space-y-2">
        {!profiles.length ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            No ICP profiles yet. Create one above to get started.
          </div>
        ) : (
          profiles.map((p) => (
            <Link
              key={p.id}
              href={`/app/manager/icp/${p.id}`}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 hover:shadow"
            >
              <div>
                <div className="text-sm font-medium text-slate-900">
                  {p.name}
                </div>
                {p.description && (
                  <div className="mt-0.5 text-xs text-slate-500 line-clamp-1">
                    {p.description}
                  </div>
                )}
                {p.territory_id && (
                  <div className="mt-0.5 text-xs text-blue-600">
                    {territoryMap.get(p.territory_id) ?? "Territory"}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {criteriaCounts.get(p.id) ?? 0} criteria
                </span>
                {!p.active && (
                  <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                    Inactive
                  </span>
                )}
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
