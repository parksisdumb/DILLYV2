import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import { createAdminClient } from "@/lib/supabase/admin";
import AgentClient from "./agent-client";

export type AgentRun = {
  id: string;
  run_type: string;
  status: string;
  prospects_found: number;
  prospects_added: number;
  prospects_skipped_dedup: number;
  source_breakdown: Record<string, { found: number; added: number; skipped: number }>;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
};

export type AgentInfo = {
  agent_name: string;
  display_name: string;
  enabled: boolean;
  last_run_at: string | null;
  run_count: number;
  total_found: number;
  total_inserted: number;
};

export type ConfidenceTiers = {
  tier80: number;
  tier60: number;
  tier40: number;
  tier20: number;
  tierBelow20: number;
};

export default async function AgentPage() {
  const { supabase, userId, orgId } = await requireServerOrgContext();

  // Role gate
  const { data: orgUser } = await supabase
    .from("org_users")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (!orgUser || !["manager", "admin"].includes(orgUser.role)) {
    redirect("/app");
  }

  const admin = createAdminClient();

  // Parallel fetches
  const [runsRes, agentProspectRes, intelCountRes, scoreDistRes, agentsRes] =
    await Promise.all([
      supabase
        .from("agent_runs")
        .select(
          "id,run_type,status,prospects_found,prospects_added,prospects_skipped_dedup,source_breakdown,started_at,completed_at,error_message"
        )
        .order("started_at", { ascending: false })
        .limit(50),
      supabase
        .from("prospects")
        .select("id", { count: "exact", head: true })
        .eq("source", "agent"),
      admin
        .from("intel_prospects")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
      admin
        .from("intel_prospects")
        .select("confidence_score")
        .eq("status", "active"),
      admin.from("agent_registry").select("*").order("agent_name"),
    ]);

  const agentRuns: AgentRun[] = (runsRes.data ?? []).map((r) => ({
    id: r.id as string,
    run_type: r.run_type as string,
    status: r.status as string,
    prospects_found: r.prospects_found as number,
    prospects_added: r.prospects_added as number,
    prospects_skipped_dedup: r.prospects_skipped_dedup as number,
    source_breakdown:
      (r.source_breakdown as Record<
        string,
        { found: number; added: number; skipped: number }
      >) ?? {},
    started_at: r.started_at as string,
    completed_at: r.completed_at as string | null,
    error_message: r.error_message as string | null,
  }));

  const scores = (scoreDistRes.data ?? []).map(
    (r) => r.confidence_score as number
  );
  const tiers: ConfidenceTiers = {
    tier80: scores.filter((s) => s >= 80).length,
    tier60: scores.filter((s) => s >= 60 && s < 80).length,
    tier40: scores.filter((s) => s >= 40 && s < 60).length,
    tier20: scores.filter((s) => s >= 20 && s < 40).length,
    tierBelow20: scores.filter((s) => s < 20).length,
  };

  const agents: AgentInfo[] = (agentsRes.data ?? []).map((a) => ({
    agent_name: a.agent_name as string,
    display_name: a.display_name as string,
    enabled: a.enabled as boolean,
    last_run_at: a.last_run_at as string | null,
    run_count: a.run_count as number,
    total_found: a.total_found as number,
    total_inserted: a.total_inserted as number,
  }));

  // Push to Dilly server action
  async function pushToDillyAction() {
    "use server";
    const { supabase: orgSupa, orgId: oId, userId: uId } =
      await requireServerOrgContext();
    const adminSupa = createAdminClient();

    const { data: intelRows } = await adminSupa
      .from("intel_prospects")
      .select("*")
      .eq("status", "active")
      .gte("confidence_score", 40)
      .is("dilly_org_id", null)
      .limit(100);

    if (!intelRows?.length) return;

    let pushed = 0;
    for (const row of intelRows) {
      const { error } = await orgSupa.from("prospects").insert({
        org_id: oId,
        company_name: row.company_name,
        website: row.company_website,
        domain_normalized: row.domain_normalized,
        email: row.contact_email,
        phone: row.contact_phone ?? row.company_phone,
        contact_first_name: row.contact_first_name,
        contact_last_name: row.contact_last_name,
        contact_title: row.contact_title,
        address_line1: row.address_line1,
        city: row.city,
        state: row.state,
        postal_code: row.postal_code,
        account_type: row.account_type,
        vertical: row.vertical,
        source: "agent",
        source_detail: row.source_detail,
        confidence_score: row.confidence_score,
        agent_metadata: {
          intel_prospect_id: row.id,
          score_breakdown: row.score_breakdown,
        },
        created_by: uId,
      });

      if (!error) {
        await adminSupa
          .from("intel_prospects")
          .update({ status: "pushed", dilly_org_id: oId })
          .eq("id", row.id);
        pushed++;
      }
      // Skip duplicates silently
    }

    revalidatePath("/app/manager/agent");
  }

  return (
    <AgentClient
      runs={agentRuns}
      agentProspectCount={agentProspectRes.count ?? 0}
      intelCount={intelCountRes.count ?? 0}
      tiers={tiers}
      agents={agents}
      pushToDillyAction={pushToDillyAction}
    />
  );
}
