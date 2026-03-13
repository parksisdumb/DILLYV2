import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";

type KpisPageSearchParams = {
  status?: string;
  message?: string;
};

type KpisPageProps = {
  searchParams: Promise<KpisPageSearchParams>;
};

type KpiTargetRow = {
  user_id: string;
  target_value: number | string;
};

const OUTREACH_KPI_KEY = "daily_outreach_touchpoints";
const OUTREACH_KPI_NAME = "Daily Outreach Touchpoints";
const OUTREACH_DEFAULT_TARGET = 20;

type ManagerContext = {
  supabase: Awaited<ReturnType<typeof requireServerOrgContext>>["supabase"];
  userId: string;
  orgId: string;
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseTargetInput(raw: FormDataEntryValue | null): number {
  const str = String(raw ?? "").trim();
  if (!str) return OUTREACH_DEFAULT_TARGET;

  const n = Number(str);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("Daily outreach target must be a number >= 0");
  }

  return n;
}

function errorRedirect(message: string): never {
  redirect(`/app/admin/kpis?status=error&message=${encodeURIComponent(message)}`);
}

async function requireManagerOrAdmin(): Promise<ManagerContext> {
  const { supabase, userId, orgId } = await requireServerOrgContext();

  const { data: orgUser, error } = await supabase
    .from("org_users")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  if (orgUser?.role !== "admin" && orgUser?.role !== "manager") {
    redirect("/app");
  }

  return { supabase, userId, orgId };
}

async function ensureOutreachKpiDefinition(context: ManagerContext): Promise<string> {
  const { error: upsertError } = await context.supabase.from("kpi_definitions").upsert(
    {
      org_id: context.orgId,
      key: OUTREACH_KPI_KEY,
      name: OUTREACH_KPI_NAME,
      metric_type: "count",
      entity_type: "touchpoint",
      entity_event: "outreach",
      created_by: context.userId,
    },
    {
      onConflict: "org_id,key",
      ignoreDuplicates: false,
    },
  );

  if (upsertError) throw new Error(upsertError.message);

  const { data, error } = await context.supabase
    .from("kpi_definitions")
    .select("id")
    .eq("org_id", context.orgId)
    .eq("key", OUTREACH_KPI_KEY)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error(`Missing KPI definition for key "${OUTREACH_KPI_KEY}"`);

  return data.id;
}

async function saveRepTargetAction(formData: FormData) {
  "use server";

  const context = await requireManagerOrAdmin();

  const repUserId = String(formData.get("rep_user_id") ?? "").trim();
  if (!repUserId) {
    errorRedirect("Missing rep user id.");
  }

  let outreachTarget: number;
  try {
    outreachTarget = parseTargetInput(formData.get("daily_outreach_touchpoints"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorRedirect(message);
  }

  const { data: memberRow, error: memberError } = await context.supabase
    .from("org_users")
    .select("user_id")
    .eq("org_id", context.orgId)
    .eq("user_id", repUserId)
    .maybeSingle();

  if (memberError) errorRedirect(memberError.message);
  if (!memberRow) {
    errorRedirect("Selected user is not a member of your org.");
  }

  let outreachDefinitionId: string;
  try {
    outreachDefinitionId = await ensureOutreachKpiDefinition(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorRedirect(message);
  }

  const { error: upsertError } = await context.supabase.from("kpi_targets").upsert(
    {
      org_id: context.orgId,
      user_id: repUserId,
      period: "daily",
      kpi_definition_id: outreachDefinitionId,
      target_value: outreachTarget,
      created_by: context.userId,
    },
    {
      onConflict: "org_id,user_id,period,kpi_definition_id",
      ignoreDuplicates: false,
    },
  );

  if (upsertError) errorRedirect(upsertError.message);

  revalidatePath("/app/admin/kpis");
  revalidatePath("/app/today");
  redirect("/app/admin/kpis?status=success");
}

export default async function AdminKpisPage({ searchParams }: KpisPageProps) {
  const params = await searchParams;
  const context = await requireManagerOrAdmin();

  const outreachDefinitionId = await ensureOutreachKpiDefinition(context);

  const { data: repUsers, error: repUsersError } = await context.supabase
    .from("org_users")
    .select("user_id, role, full_name, email")
    .eq("org_id", context.orgId)
    .order("role")
    .order("full_name");

  if (repUsersError) throw new Error(repUsersError.message);

  const orgUserRows = repUsers ?? [];
  const userIds = orgUserRows.map((row) => row.user_id);

  const { data: targetsData, error: targetsError } = userIds.length
    ? await context.supabase
        .from("kpi_targets")
        .select("user_id,target_value")
        .eq("org_id", context.orgId)
        .eq("period", "daily")
        .eq("kpi_definition_id", outreachDefinitionId)
        .in("user_id", userIds)
    : { data: [], error: null };

  if (targetsError) throw new Error(targetsError.message);

  const targetByUserId = new Map<string, number>();
  for (const row of (targetsData ?? []) as KpiTargetRow[]) {
    const numericValue = toNumber(row.target_value);
    if (numericValue === null) continue;
    targetByUserId.set(row.user_id, numericValue);
  }

  const rows = orgUserRows.map((u) => ({
    userId: u.user_id,
    name: u.full_name?.trim() || null,
    email: u.email || null,
    role: u.role,
    outreachTarget: targetByUserId.get(u.user_id) ?? OUTREACH_DEFAULT_TARGET,
  }));

  const status = params.status;
  const message = params.message;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">KPIs</h1>
        <p className="text-sm text-slate-600">
          Set daily outreach touchpoint targets for reps.
        </p>
      </div>

      {status === "success" && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          KPI target saved.
        </p>
      )}
      {status === "error" && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {message || "Failed to save KPI target."}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {!rows.length ? (
          <p className="p-5 text-sm text-slate-600">No team members found in this organization.</p>
        ) : (
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Rep</th>
                <th className="px-4 py-3">Daily Outreach Target</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.userId}>
                  <td className="px-4 py-3 align-top">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900">
                        {row.name || row.email || row.userId.slice(0, 8)}
                      </span>
                      <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-xs font-medium capitalize text-slate-600">
                        {row.role}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600">
                      {row.email || `${row.userId.slice(0, 8)}...`}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      form={`save-kpi-${row.userId}`}
                      name="daily_outreach_touchpoints"
                      type="number"
                      min={0}
                      step={1}
                      defaultValue={row.outreachTarget}
                      className="h-9 w-32 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
                      required
                    />
                  </td>
                  <td className="px-4 py-3">
                    <form id={`save-kpi-${row.userId}`} action={saveRepTargetAction}>
                      <input type="hidden" name="rep_user_id" value={row.userId} />
                      <button className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">
                        Save
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
