import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import ICPDetailClient from "./icp-detail-client";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function ICPDetailPage({ params, searchParams }: Props) {
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

  // Fetch profile
  const { data: profile, error: pError } = await supabase
    .from("icp_profiles")
    .select("id, name, description, active, territory_id, created_at")
    .eq("id", id)
    .maybeSingle();

  if (pError) throw new Error(pError.message);
  if (!profile) notFound();

  // Fetch criteria and territories in parallel
  const [criteriaResult, territoriesResult] = await Promise.all([
    supabase
      .from("icp_criteria")
      .select("id, criteria_type, criteria_value")
      .eq("icp_profile_id", id)
      .order("criteria_type"),
    supabase.from("territories").select("id, name").order("name"),
  ]);

  const criteria = criteriaResult.data ?? [];
  const territories = territoriesResult.data ?? [];

  const basePath = `/app/manager/icp/${id}`;

  // Server actions
  async function updateProfileAction(formData: FormData) {
    "use server";
    const { supabase } = await requireServerOrgContext();

    const profileId = String(formData.get("profile_id") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const territoryId = String(formData.get("territory_id") ?? "").trim();
    const active = formData.get("active") === "true";

    if (!name) {
      redirect(`${basePath}?error=Name+is+required`);
    }

    const { error } = await supabase
      .from("icp_profiles")
      .update({
        name,
        description: description || null,
        territory_id: territoryId || null,
        active,
      })
      .eq("id", profileId);

    if (error) {
      redirect(`${basePath}?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(basePath);
    redirect(basePath);
  }

  async function saveCriteriaAction(formData: FormData) {
    "use server";
    const { supabase, orgId } = await requireServerOrgContext();

    const profileId = String(formData.get("profile_id") ?? "").trim();
    const criteriaJson = String(formData.get("criteria_json") ?? "[]");

    let newCriteria: { criteria_type: string; criteria_value: string }[];
    try {
      newCriteria = JSON.parse(criteriaJson);
    } catch {
      redirect(`${basePath}?error=Invalid+criteria+data`);
      return;
    }

    // Delete existing criteria, then insert new ones
    const { error: deleteError } = await supabase
      .from("icp_criteria")
      .delete()
      .eq("icp_profile_id", profileId);

    if (deleteError) {
      redirect(`${basePath}?error=${encodeURIComponent(deleteError.message)}`);
    }

    if (newCriteria.length > 0) {
      const rows = newCriteria.map((c) => ({
        icp_profile_id: profileId,
        org_id: orgId,
        criteria_type: c.criteria_type,
        criteria_value: c.criteria_value,
      }));

      const { error: insertError } = await supabase
        .from("icp_criteria")
        .insert(rows);

      if (insertError) {
        redirect(
          `${basePath}?error=${encodeURIComponent(insertError.message)}`,
        );
      }
    }

    revalidatePath(basePath);
    redirect(basePath);
  }

  async function deleteProfileAction(formData: FormData) {
    "use server";
    const { supabase } = await requireServerOrgContext();

    const profileId = String(formData.get("profile_id") ?? "").trim();

    await supabase.from("icp_profiles").delete().eq("id", profileId);

    revalidatePath("/app/manager/icp");
    redirect("/app/manager/icp");
  }

  return (
    <div className="space-y-4">
      <Link
        href="/app/manager/icp"
        className="text-sm text-slate-500 hover:text-slate-700"
      >
        &larr; Back to ICP Profiles
      </Link>

      {sp.error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {sp.error}
        </p>
      )}

      <ICPDetailClient
        profile={profile}
        criteria={criteria}
        territories={territories}
        updateProfileAction={updateProfileAction}
        saveCriteriaAction={saveCriteriaAction}
        deleteProfileAction={deleteProfileAction}
      />
    </div>
  );
}
