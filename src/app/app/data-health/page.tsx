import { requireServerOrgContext } from "@/lib/supabase/server-org";
import DataHealthView from "@/app/app/manager/data-health-view";

// Standalone Data Health (File Completeness) page so it's reachable from the
// sidebar on every page — not only buried as a tab inside /app/manager.
export default async function DataHealthPage() {
  const { supabase, orgId } = await requireServerOrgContext();

  const { data: users } = await supabase
    .from("org_users")
    .select("user_id,full_name,email")
    .order("full_name");

  const reps = (users ?? []).map((u) => ({
    userId: u.user_id as string,
    name:
      (u.full_name as string | null)?.trim() ||
      (u.email as string | null)?.split("@")[0] ||
      (u.user_id as string).slice(0, 8),
  }));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Data Health</h1>
      <p className="text-sm text-slate-500">
        File completeness across accounts, contacts, properties, and opportunities — fix the gaps worst-first.
      </p>
      <DataHealthView reps={reps} orgId={orgId} />
    </div>
  );
}
