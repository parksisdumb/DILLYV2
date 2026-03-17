import { redirect } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
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

export default async function AgentPage() {
  const { supabase, userId } = await requireServerOrgContext();

  // Role gate
  const { data: orgUser } = await supabase
    .from("org_users")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (!orgUser || !["manager", "admin"].includes(orgUser.role)) {
    redirect("/app");
  }

  // Fetch agent runs
  const { data: runs } = await supabase
    .from("agent_runs")
    .select(
      "id,run_type,status,prospects_found,prospects_added,prospects_skipped_dedup,source_breakdown,started_at,completed_at,error_message"
    )
    .order("started_at", { ascending: false })
    .limit(50);

  // Count agent-sourced prospects
  const { count: agentProspectCount } = await supabase
    .from("prospects")
    .select("id", { count: "exact", head: true })
    .eq("source", "agent");

  const agentRuns: AgentRun[] = (runs ?? []).map((r) => ({
    id: r.id as string,
    run_type: r.run_type as string,
    status: r.status as string,
    prospects_found: r.prospects_found as number,
    prospects_added: r.prospects_added as number,
    prospects_skipped_dedup: r.prospects_skipped_dedup as number,
    source_breakdown: (r.source_breakdown as Record<string, { found: number; added: number; skipped: number }>) ?? {},
    started_at: r.started_at as string,
    completed_at: r.completed_at as string | null,
    error_message: r.error_message as string | null,
  }));

  return (
    <AgentClient
      runs={agentRuns}
      agentProspectCount={agentProspectCount ?? 0}
    />
  );
}
