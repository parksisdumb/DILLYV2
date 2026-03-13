import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import TerritoryDetailClient from "./territory-detail-client";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function TerritoryDetailPage({
  params,
  searchParams,
}: Props) {
  const { supabase, userId, orgId } = await requireServerOrgContext();
  const { id } = await params;
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

  // Fetch territory
  const { data: territory, error: tError } = await supabase
    .from("territories")
    .select("id, name, description, active, created_at")
    .eq("id", id)
    .maybeSingle();

  if (tError) throw new Error(tError.message);
  if (!territory) notFound();

  // Fetch regions, assignments, and org users in parallel
  const [regionsResult, assignmentsResult, orgUsersResult, profilesResult] =
    await Promise.all([
      supabase
        .from("territory_regions")
        .select("id, region_type, region_value, state")
        .eq("territory_id", id)
        .order("state")
        .order("region_value"),
      supabase
        .from("territory_assignments")
        .select("id, user_id, role, active")
        .eq("territory_id", id),
      supabase.from("org_users").select("user_id, role"),
      supabase.from("profiles").select("user_id, full_name"),
    ]);

  const regions = regionsResult.data ?? [];
  const rawAssignments = assignmentsResult.data ?? [];
  const rawOrgUsers = orgUsersResult.data ?? [];
  const profiles = profilesResult.data ?? [];

  const profileMap = new Map<string, string>();
  for (const p of profiles) {
    if (p.full_name) profileMap.set(p.user_id, p.full_name);
  }

  const assignments = rawAssignments.map((a) => ({
    ...a,
    fullName: profileMap.get(a.user_id) ?? a.user_id,
  }));

  const orgUsers = rawOrgUsers.map((u) => ({
    user_id: u.user_id,
    fullName: profileMap.get(u.user_id) ?? u.user_id,
  }));

  const basePath = `/app/manager/territories/${id}`;

  // Server actions
  async function addRegionAction(formData: FormData) {
    "use server";
    const { supabase, orgId } = await requireServerOrgContext();

    const territoryId = String(formData.get("territory_id") ?? "").trim();
    const regionType = String(formData.get("region_type") ?? "").trim();
    const regionValue = String(formData.get("region_value") ?? "").trim();
    const state = String(formData.get("state") ?? "").trim();

    if (!regionValue || !state) {
      redirect(`${basePath}?error=Value+and+state+are+required`);
    }

    const { error } = await supabase.from("territory_regions").insert({
      territory_id: territoryId,
      org_id: orgId,
      region_type: regionType,
      region_value: regionValue,
      state,
    });

    if (error) {
      const msg = error.message.includes("territory_regions_dedupe_idx")
        ? "This region already exists in this territory"
        : error.message;
      redirect(`${basePath}?error=${encodeURIComponent(msg)}`);
    }

    revalidatePath(basePath);
    redirect(basePath);
  }

  async function removeRegionAction(formData: FormData) {
    "use server";
    const { supabase } = await requireServerOrgContext();
    const regionId = String(formData.get("region_id") ?? "").trim();

    await supabase.from("territory_regions").delete().eq("id", regionId);

    revalidatePath(basePath);
    redirect(basePath);
  }

  async function assignRepAction(formData: FormData) {
    "use server";
    const { supabase, userId: actingUserId, orgId } =
      await requireServerOrgContext();

    const territoryId = String(formData.get("territory_id") ?? "").trim();
    const repUserId = String(formData.get("user_id") ?? "").trim();
    const role = String(formData.get("role") ?? "primary").trim();

    if (!repUserId) {
      redirect(`${basePath}?error=Select+a+rep`);
    }

    const { error } = await supabase.from("territory_assignments").insert({
      org_id: orgId,
      territory_id: territoryId,
      user_id: repUserId,
      role,
      created_by: actingUserId,
    });

    if (error) {
      const msg = error.message.includes("territory_assignments_dedupe_idx")
        ? "This rep is already assigned to this territory"
        : error.message;
      redirect(`${basePath}?error=${encodeURIComponent(msg)}`);
    }

    revalidatePath(basePath);
    redirect(basePath);
  }

  async function unassignRepAction(formData: FormData) {
    "use server";
    const { supabase } = await requireServerOrgContext();
    const assignmentId = String(formData.get("assignment_id") ?? "").trim();

    await supabase
      .from("territory_assignments")
      .delete()
      .eq("id", assignmentId);

    revalidatePath(basePath);
    redirect(basePath);
  }

  return (
    <div className="space-y-4">
      <Link
        href="/app/manager/territories"
        className="text-sm text-slate-500 hover:text-slate-700"
      >
        &larr; Back to territories
      </Link>

      {sp.error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {sp.error}
        </p>
      )}

      <TerritoryDetailClient
        territory={territory}
        regions={regions}
        assignments={assignments}
        orgUsers={orgUsers}
        addRegionAction={addRegionAction}
        removeRegionAction={removeRegionAction}
        assignRepAction={assignRepAction}
        unassignRepAction={unassignRepAction}
      />
    </div>
  );
}
