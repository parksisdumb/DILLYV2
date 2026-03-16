import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import ProspectsClient from "./prospects-client";

export type ProspectRow = {
  id: string;
  company_name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  account_type: string | null;
  vertical: string | null;
  status: string;
  territory_id: string | null;
  territory_name: string | null;
  source: string;
  source_detail: string | null;
  confidence_score: number;
  notes: string | null;
  created_at: string;
  assigned_to: string | null;
};

type TerritoryOption = { id: string; name: string };

type OrgUserOption = { id: string; full_name: string | null; email: string | null };

export default async function ProspectsPage() {
  const { supabase, userId, orgId } = await requireServerOrgContext();

  // role gate
  const { data: orgUser } = await supabase
    .from("org_users")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (!orgUser || !["manager", "admin"].includes(orgUser.role)) {
    redirect("/app");
  }

  const [prospectRes, territoryRes, orgUsersRes, suggestedRes] = await Promise.all([
    supabase
      .from("prospects")
      .select("id,company_name,email,phone,website,address_line1,city,state,postal_code,account_type,vertical,status,territory_id,source,source_detail,confidence_score,notes,created_at")
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase
      .from("territories")
      .select("id,name")
      .eq("active", true)
      .order("name"),
    supabase
      .from("org_users")
      .select("user_id,full_name,email")
      .order("full_name"),
    supabase
      .from("suggested_outreach")
      .select("prospect_id,user_id,status")
      .in("status", ["new", "accepted"]),
  ]);

  if (prospectRes.error) throw new Error(prospectRes.error.message);

  const territories: TerritoryOption[] = (territoryRes.data ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
  }));

  const orgUsers: OrgUserOption[] = (orgUsersRes.data ?? []).map((u) => ({
    id: u.user_id as string,
    full_name: u.full_name as string | null,
    email: u.email as string | null,
  }));

  const territoryMap = new Map(territories.map((t) => [t.id, t.name]));

  // Build assignment map: prospect_id → rep name (for active assignments)
  const userNameMap = new Map(orgUsers.map((u) => [u.id, u.full_name ?? u.email ?? u.id.slice(0, 8)]));
  const assignmentMap = new Map<string, string>();
  const queueCountsByUser = new Map<string, number>();
  for (const s of suggestedRes.data ?? []) {
    const pid = s.prospect_id as string;
    const uid = s.user_id as string;
    if (!assignmentMap.has(pid)) {
      assignmentMap.set(pid, userNameMap.get(uid) ?? uid.slice(0, 8));
    }
    queueCountsByUser.set(uid, (queueCountsByUser.get(uid) ?? 0) + 1);
  }
  const repQueueCounts: { name: string; count: number }[] = orgUsers.map((u) => ({
    name: u.full_name ?? u.email ?? u.id.slice(0, 8),
    count: queueCountsByUser.get(u.id) ?? 0,
  }));

  const rows: ProspectRow[] = (prospectRes.data ?? []).map((p) => ({
    id: p.id as string,
    company_name: p.company_name as string,
    email: p.email as string | null,
    phone: p.phone as string | null,
    website: p.website as string | null,
    address_line1: p.address_line1 as string | null,
    city: p.city as string | null,
    state: p.state as string | null,
    postal_code: p.postal_code as string | null,
    account_type: p.account_type as string | null,
    vertical: p.vertical as string | null,
    status: p.status as string,
    territory_id: p.territory_id as string | null,
    territory_name: territoryMap.get(p.territory_id as string) ?? null,
    source: p.source as string,
    source_detail: p.source_detail as string | null,
    confidence_score: p.confidence_score as number,
    notes: p.notes as string | null,
    created_at: p.created_at as string,
    assigned_to: assignmentMap.get(p.id as string) ?? null,
  }));

  // ── Server actions ──

  async function bulkUpdateStatusAction(formData: FormData) {
    "use server";
    const { supabase: sb } = await requireServerOrgContext();
    const idsJson = String(formData.get("ids") ?? "[]");
    const newStatus = String(formData.get("status") ?? "");
    if (!["unworked", "queued", "converted", "dismissed"].includes(newStatus)) {
      redirect("/app/manager/prospects?error=Invalid+status");
    }
    let ids: string[];
    try { ids = JSON.parse(idsJson); } catch { redirect("/app/manager/prospects?error=Invalid+data"); }
    if (!ids.length) redirect("/app/manager/prospects");

    const { error } = await sb
      .from("prospects")
      .update({ status: newStatus })
      .in("id", ids);
    if (error) redirect(`/app/manager/prospects?error=${encodeURIComponent(error.message)}`);
    revalidatePath("/app/manager/prospects");
    redirect("/app/manager/prospects");
  }

  async function assignToRepAction(formData: FormData) {
    "use server";
    const { supabase: sb, userId: uid, orgId: oid } = await requireServerOrgContext();
    const idsJson = String(formData.get("ids") ?? "[]");
    const repUserId = String(formData.get("user_id") ?? "").trim();
    if (!repUserId) redirect("/app/manager/prospects?error=Select+a+rep");

    let ids: string[];
    try { ids = JSON.parse(idsJson); } catch { redirect("/app/manager/prospects?error=Invalid+data"); }
    if (!ids.length) redirect("/app/manager/prospects");

    // Cap: reject if rep already has 5+ active suggestions
    const { count } = await sb
      .from("suggested_outreach")
      .select("id", { count: "exact", head: true })
      .eq("user_id", repUserId)
      .eq("status", "new");
    if ((count ?? 0) >= 5) {
      redirect("/app/manager/prospects?error=Rep+already+has+5+active+suggestions.+Dismiss+or+wait.");
    }

    // Build reason codes based on prospect data
    const rows = ids.slice(0, 5 - (count ?? 0)).map((prospectId) => ({
      org_id: oid,
      user_id: repUserId,
      prospect_id: prospectId,
      reason_codes: ["manager_pick"],
      assigned_by: uid,
    }));

    const { error } = await sb.from("suggested_outreach").insert(rows);
    if (error) {
      const msg = error.message.includes("suggested_outreach_dedupe_idx")
        ? "Some prospects are already assigned to this rep"
        : error.message;
      redirect(`/app/manager/prospects?error=${encodeURIComponent(msg)}`);
    }

    revalidatePath("/app/manager/prospects");
    redirect(`/app/manager/prospects?assigned=${rows.length}`);
  }

  return (
    <ProspectsClient
      prospects={rows}
      territories={territories}
      orgUsers={orgUsers}
      repQueueCounts={repQueueCounts}
      bulkUpdateStatusAction={bulkUpdateStatusAction}
      assignToRepAction={assignToRepAction}
    />
  );
}
