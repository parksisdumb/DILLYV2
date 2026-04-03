import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";
import IntelDbClient from "./intel-db-client";

export type DbHealth = {
  totalProperties: number;
  totalProspects: number;
  totalEntities: number;
  withAddress: number;
  withPhone: number;
  withEmail: number;
  withOwner: number;
  pctAddress: number;
  pctPhone: number;
  pctEmail: number;
  pctOwner: number;
};

export type SourceBreakdown = { source: string; count: number; pct: number };
export type StateBreakdown = { state: string; count: number };
export type WeeklyGrowth = { week: string; properties: number; prospects: number };
export type AgentRunRow = {
  id: string;
  run_type: string;
  status: string;
  prospects_found: number;
  prospects_added: number;
  started_at: string;
  completed_at: string | null;
  duration_s: number | null;
};

export default async function IntelDatabasePage() {
  await requireAdmin();
  const admin = createAdminClient();

  // Parallel fetches
  const [
    propsRes,
    prospectsRes,
    entitiesRes,
    runsRes,
  ] = await Promise.all([
    admin.from("intel_properties").select("id,street_address,owner_name,source_detail,state,created_at"),
    admin.from("intel_prospects").select("id,address_line1,company_phone,contact_email,company_name,source_detail,state,created_at"),
    admin.from("intel_entities").select("id", { count: "exact", head: true }),
    admin.from("agent_runs").select("id,run_type,status,prospects_found,prospects_added,started_at,completed_at").order("started_at", { ascending: false }).limit(20),
  ]);

  const props = propsRes.data ?? [];
  const prospects = prospectsRes.data ?? [];
  const totalProperties = props.length;
  const totalProspects = prospects.length;
  const totalEntities = entitiesRes.count ?? 0;

  // Health stats from prospects (the bigger dataset)
  const withAddress = prospects.filter((p) => p.address_line1).length;
  const withPhone = prospects.filter((p) => p.company_phone).length;
  const withEmail = prospects.filter((p) => p.contact_email).length;
  const withOwner = prospects.filter((p) => p.company_name).length;
  const total = totalProspects || 1;

  const health: DbHealth = {
    totalProperties,
    totalProspects,
    totalEntities,
    withAddress,
    withPhone,
    withEmail,
    withOwner,
    pctAddress: Math.round((withAddress / total) * 100),
    pctPhone: Math.round((withPhone / total) * 100),
    pctEmail: Math.round((withEmail / total) * 100),
    pctOwner: Math.round((withOwner / total) * 100),
  };

  // Source breakdown
  const sourceCounts = new Map<string, number>();
  for (const p of prospects) {
    const src = (p.source_detail as string) ?? "unknown";
    sourceCounts.set(src, (sourceCounts.get(src) ?? 0) + 1);
  }
  const sourceBreakdown: SourceBreakdown[] = [...sourceCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => ({
      source,
      count,
      pct: Math.round((count / total) * 100),
    }));

  // State breakdown (top 15)
  const stateCounts = new Map<string, number>();
  for (const p of prospects) {
    const st = (p.state as string | null)?.toUpperCase();
    if (st) stateCounts.set(st, (stateCounts.get(st) ?? 0) + 1);
  }
  const stateBreakdown: StateBreakdown[] = [...stateCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([state, count]) => ({ state, count }));

  // Weekly growth (last 12 weeks)
  const now = new Date();
  const weeklyGrowth: WeeklyGrowth[] = [];
  for (let w = 11; w >= 0; w--) {
    const weekStart = new Date(now.getTime() - (w + 1) * 7 * 86400000);
    const weekEnd = new Date(now.getTime() - w * 7 * 86400000);
    const label = `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;

    const propCount = props.filter((p) => {
      const d = new Date(p.created_at as string);
      return d >= weekStart && d < weekEnd;
    }).length;

    const prospCount = prospects.filter((p) => {
      const d = new Date(p.created_at as string);
      return d >= weekStart && d < weekEnd;
    }).length;

    weeklyGrowth.push({ week: label, properties: propCount, prospects: prospCount });
  }

  // Agent runs
  const agentRuns: AgentRunRow[] = (runsRes.data ?? []).map((r) => {
    const started = r.started_at ? new Date(r.started_at as string).getTime() : 0;
    const completed = r.completed_at ? new Date(r.completed_at as string).getTime() : 0;
    return {
      id: r.id as string,
      run_type: r.run_type as string,
      status: r.status as string,
      prospects_found: r.prospects_found as number,
      prospects_added: r.prospects_added as number,
      started_at: r.started_at as string,
      completed_at: r.completed_at as string | null,
      duration_s: completed > started ? Math.round((completed - started) / 1000) : null,
    };
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/admin" className="text-sm text-slate-400 hover:text-white">
            &larr; Admin
          </Link>
          <h1 className="text-2xl font-bold text-white">Intel Database</h1>
        </div>
      </div>
      <IntelDbClient
        health={health}
        sourceBreakdown={sourceBreakdown}
        stateBreakdown={stateBreakdown}
        weeklyGrowth={weeklyGrowth}
        agentRuns={agentRuns}
      />
    </div>
  );
}
