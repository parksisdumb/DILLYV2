import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireServerOrgContext } from "@/lib/supabase/server-org";

async function createTerritoryAction(formData: FormData) {
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

  if (!name) {
    redirect("/app/manager/territories?error=Name+is+required");
  }

  const { error } = await supabase.from("territories").insert({
    org_id: orgId,
    name,
    description: description || null,
    created_by: userId,
  });

  if (error) {
    redirect(
      `/app/manager/territories?error=${encodeURIComponent(error.message)}`,
    );
  }

  revalidatePath("/app/manager/territories");
  redirect("/app/manager/territories?created=1");
}

type PageProps = {
  searchParams: Promise<{ error?: string; created?: string }>;
};

export default async function TerritoriesPage({ searchParams }: PageProps) {
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

  // Fetch territories
  const { data: territories } = await supabase
    .from("territories")
    .select("id, name, description, active, created_at")
    .order("name");

  // Fetch region counts
  const { data: regions } = await supabase
    .from("territory_regions")
    .select("territory_id");

  // Fetch assignment counts
  const { data: assignments } = await supabase
    .from("territory_assignments")
    .select("territory_id, user_id")
    .eq("active", true);

  const regionCounts = new Map<string, number>();
  for (const r of regions ?? []) {
    regionCounts.set(r.territory_id, (regionCounts.get(r.territory_id) ?? 0) + 1);
  }

  const assignmentCounts = new Map<string, number>();
  for (const a of assignments ?? []) {
    assignmentCounts.set(
      a.territory_id,
      (assignmentCounts.get(a.territory_id) ?? 0) + 1,
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Territories
        </h1>
        <p className="text-sm text-slate-600">
          Define where your reps work by zip code, city, or county.
        </p>
      </div>

      {sp.created && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Territory created.
        </p>
      )}
      {sp.error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {sp.error}
        </p>
      )}

      {/* Create form */}
      <form
        action={createTerritoryAction}
        className="max-w-xl space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">
            Territory Name
          </label>
          <input
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
            name="name"
            required
            placeholder="e.g. North Dallas"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">
            Description (optional)
          </label>
          <input
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
            name="description"
            placeholder="Brief description of this territory"
          />
        </div>
        <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          Create Territory
        </button>
      </form>

      {/* Territory list */}
      <div className="space-y-2">
        {!territories?.length ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            No territories yet. Create one above to get started.
          </div>
        ) : (
          territories.map((t) => (
            <div
              key={t.id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <Link
                    href={`/app/manager/territories/${t.id}`}
                    className="text-sm font-medium text-slate-900 hover:text-blue-600 hover:underline"
                  >
                    {t.name}
                  </Link>
                  {t.description && (
                    <div className="mt-0.5 text-xs text-slate-500 line-clamp-1">
                      {t.description}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {regionCounts.get(t.id) ?? 0} regions
                  </span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {assignmentCounts.get(t.id) ?? 0} reps
                  </span>
                  {!t.active && (
                    <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                      Inactive
                    </span>
                  )}
                  <Link
                    href={`/app/manager/territories/${t.id}/penetration`}
                    className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-100"
                  >
                    Penetration
                  </Link>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
