import { redirect } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import ManagerClient from "@/app/app/manager/manager-client";

// ── Exported types consumed by manager-client ──────────────────────────────

export type RepStat = {
  userId: string;
  name: string;
  email: string | null;
  role: string;
  firstTouchToday: number;
  followUpToday: number;
  targetFirstTouch: number;
  targetFollowUp: number;
  pointsThisWeek: number;
  pointsThisMonth: number;
  nextActionsTotal30d: number;
  nextActionsCompleted30d: number;
  complianceRate: number;
};

export type StageSummary = {
  stageId: string;
  stageName: string;
  sortOrder: number;
  count: number;
  avgDaysOpen: number;
  maxDaysOpen: number;
};

export type TopAccount = {
  accountId: string;
  accountName: string;
  touchpointCount30d: number;
};

export type PipelineHealth = "active" | "cooling" | "stalled" | "no_activity";

export type PipelineRow = {
  oppId: string;
  oppTitle: string | null;
  estimatedValue: number | null;
  stageName: string;
  accountId: string | null;
  accountName: string;
  propertyId: string | null;
  propertyName: string | null;
  propertyAddress: string;
  repName: string | null;
  daysInStage: number;
  lastActivityAt: string | null;
  daysSinceActivity: number | null;
  health: PipelineHealth;
};

export type PipelineSummary = {
  totalValue: number;
  activeCount: number;
  coolingCount: number;
  stalledCount: number;
  noActivityCount: number;
};

// ── Page ───────────────────────────────────────────────────────────────────

export default async function ManagerPage() {
  const { supabase, userId, orgId } = await requireServerOrgContext();

  // Role gate
  const meRes = await supabase.from("org_users").select("role").eq("user_id", userId).maybeSingle();
  if (meRes.data?.role !== "manager" && meRes.data?.role !== "admin") {
    redirect("/app");
  }

  // Date boundaries (UTC)
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const utcDay = now.getUTCDay();
  const diffToMonday = utcDay === 0 ? 6 : utcDay - 1;
  const weekStart = new Date(todayStart);
  weekStart.setUTCDate(todayStart.getUTCDate() - diffToMonday);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Parallel fetches — no org_id filters (RLS handles scoping)
  const [
    orgUsersRes,
    ttypesRes,
    todayTpsRes,
    kpiDefsRes,
    kpiTargetsRes,
    monthScoreRes,
    nextActionsRes,
    openOppsRes,
    stagesRes,
    recentTpsRes,
    accountsRes,
  ] = await Promise.all([
    supabase.from("org_users").select("user_id, role, full_name, email").order("full_name"),
    supabase.from("touchpoint_types").select("id,is_outreach,key"),
    supabase
      .from("touchpoints")
      .select("rep_user_id,engagement_phase,touchpoint_type_id")
      .gte("happened_at", todayStart.toISOString()),
    supabase
      .from("kpi_definitions")
      .select("id,key")
      .in("key", ["daily_first_touch_outreach", "daily_follow_up_outreach", "daily_outreach_touchpoints"]),
    supabase
      .from("kpi_targets")
      .select("user_id,kpi_definition_id,target_value")
      .eq("period", "daily"),
    supabase
      .from("score_events")
      .select("user_id,points,created_at")
      .gte("created_at", monthStart.toISOString()),
    supabase
      .from("next_actions")
      .select("assigned_user_id,status,due_at")
      .gte("due_at", thirtyDaysAgo.toISOString()),
    supabase
      .from("opportunities")
      .select("id,title,stage_id,account_id,property_id,estimated_value,opened_at,updated_at")
      .eq("status", "open")
      .is("deleted_at", null),
    supabase.from("opportunity_stages").select("id,name,key,sort_order,is_closed_stage").order("sort_order"),
    supabase
      .from("touchpoints")
      .select("account_id")
      .gte("happened_at", thirtyDaysAgo.toISOString())
      .not("account_id", "is", null),
    supabase.from("accounts").select("id,name").is("deleted_at", null),
  ]);

  const orgUserRows = orgUsersRes.data ?? [];
  const repUserIds = orgUserRows.map((r) => r.user_id);

  // ── Build lookup maps ──────────────────────────────────────────────────

  const ttypeById = new Map<string, { is_outreach: boolean; key: string }>();
  for (const t of ttypesRes.data ?? []) {
    ttypeById.set(t.id as string, { is_outreach: t.is_outreach as boolean, key: t.key as string });
  }

  // kpi_definitions: prefer org-specific over global — just take the last one per key
  const kpiDefByKey = new Map<string, string>(); // key → definition id
  for (const d of kpiDefsRes.data ?? []) {
    kpiDefByKey.set(d.key as string, d.id as string);
  }

  // kpi_targets: user_id → Map<definition_id, target_value>
  const kpiTargetsByUser = new Map<string, Map<string, number>>();
  for (const kt of kpiTargetsRes.data ?? []) {
    const uid = kt.user_id as string;
    const defId = kt.kpi_definition_id as string;
    const val = Number(kt.target_value);
    if (!kpiTargetsByUser.has(uid)) kpiTargetsByUser.set(uid, new Map());
    kpiTargetsByUser.get(uid)!.set(defId, val);
  }

  // Group today's touchpoints by rep_user_id
  type TodayTp = { rep_user_id: string; engagement_phase: string; touchpoint_type_id: string };
  const todayByRep = new Map<string, TodayTp[]>();
  for (const tp of todayTpsRes.data ?? []) {
    const uid = tp.rep_user_id as string;
    if (!todayByRep.has(uid)) todayByRep.set(uid, []);
    todayByRep.get(uid)!.push({
      rep_user_id: uid,
      engagement_phase: tp.engagement_phase as string,
      touchpoint_type_id: tp.touchpoint_type_id as string,
    });
  }

  // Group score_events by user_id
  type ScoreEvent = { user_id: string; points: number; created_at: string };
  const scoresByRep = new Map<string, ScoreEvent[]>();
  for (const se of monthScoreRes.data ?? []) {
    const uid = se.user_id as string;
    if (!scoresByRep.has(uid)) scoresByRep.set(uid, []);
    scoresByRep.get(uid)!.push({ user_id: uid, points: se.points as number, created_at: se.created_at as string });
  }

  // Group next_actions by assigned_user_id
  type NextAction = { assigned_user_id: string; status: string; due_at: string };
  const actionsByRep = new Map<string, NextAction[]>();
  for (const na of nextActionsRes.data ?? []) {
    const uid = na.assigned_user_id as string;
    if (!actionsByRep.has(uid)) actionsByRep.set(uid, []);
    actionsByRep.get(uid)!.push({
      assigned_user_id: uid,
      status: na.status as string,
      due_at: na.due_at as string,
    });
  }

  // ── Build RepStat[] ────────────────────────────────────────────────────

  const ftDefId = kpiDefByKey.get("daily_first_touch_outreach");
  const fuDefId = kpiDefByKey.get("daily_follow_up_outreach");

  const repStats: RepStat[] = orgUserRows.map((member) => {
    const uid = member.user_id;
    const todayTps = todayByRep.get(uid) ?? [];

    const firstTouchToday = todayTps.filter((t) => {
      const tt = ttypeById.get(t.touchpoint_type_id);
      return (tt?.is_outreach ?? false) && t.engagement_phase === "first_touch";
    }).length;

    const followUpToday = todayTps.filter((t) => {
      const tt = ttypeById.get(t.touchpoint_type_id);
      return (tt?.is_outreach ?? false) && t.engagement_phase === "follow_up";
    }).length;

    const userTargets = kpiTargetsByUser.get(uid) ?? new Map<string, number>();
    const targetFirstTouch = (ftDefId ? userTargets.get(ftDefId) : undefined) ?? 20;
    const targetFollowUp = (fuDefId ? userTargets.get(fuDefId) : undefined) ?? 10;

    const scores = scoresByRep.get(uid) ?? [];
    const pointsThisMonth = scores.reduce((s, e) => s + e.points, 0);
    const pointsThisWeek = scores
      .filter((e) => new Date(e.created_at) >= weekStart)
      .reduce((s, e) => s + e.points, 0);

    const actions = actionsByRep.get(uid) ?? [];
    const nextActionsTotal30d = actions.length;
    const nextActionsCompleted30d = actions.filter((a) => a.status === "completed").length;
    const complianceRate =
      nextActionsTotal30d > 0 ? Math.round((nextActionsCompleted30d / nextActionsTotal30d) * 100) : 0;

    const name = member.full_name?.trim() || member.email?.split("@")[0] || uid.slice(0, 8);

    return {
      userId: uid,
      name,
      email: member.email ?? null,
      role: member.role,
      firstTouchToday,
      followUpToday,
      targetFirstTouch,
      targetFollowUp,
      pointsThisWeek,
      pointsThisMonth,
      nextActionsTotal30d,
      nextActionsCompleted30d,
      complianceRate,
    };
  });

  // ── Build StageSummary[] ───────────────────────────────────────────────

  const openStages = (stagesRes.data ?? []).filter((s) => !s.is_closed_stage);
  const oppsByStage = new Map<string, { opened_at: string }[]>();
  for (const opp of openOppsRes.data ?? []) {
    const sid = opp.stage_id as string;
    if (!oppsByStage.has(sid)) oppsByStage.set(sid, []);
    oppsByStage.get(sid)!.push({ opened_at: opp.opened_at as string });
  }

  const nowMs = Date.now();
  const stageSummaries: StageSummary[] = openStages.map((s) => {
    const opps = oppsByStage.get(s.id as string) ?? [];
    const days = opps.map((o) => Math.floor((nowMs - new Date(o.opened_at).getTime()) / 86400000));
    const count = opps.length;
    const avgDaysOpen = count > 0 ? Math.round(days.reduce((a, b) => a + b, 0) / count) : 0;
    const maxDaysOpen = count > 0 ? Math.max(...days) : 0;
    return {
      stageId: s.id as string,
      stageName: s.name as string,
      sortOrder: s.sort_order as number,
      count,
      avgDaysOpen,
      maxDaysOpen,
    };
  });

  // ── Pipeline Health: dependent fetches (properties, assignments, last activity) ──

  type OpenOppRow = {
    id: string;
    title: string | null;
    stage_id: string;
    account_id: string | null;
    property_id: string | null;
    estimated_value: number | null;
    opened_at: string;
    updated_at: string;
  };
  const openOppsTyped = (openOppsRes.data ?? []) as unknown as OpenOppRow[];
  const oppPropertyIds = Array.from(
    new Set(openOppsTyped.map((o) => o.property_id).filter((v): v is string => Boolean(v))),
  );
  const oppAccountIds = Array.from(
    new Set(openOppsTyped.map((o) => o.account_id).filter((v): v is string => Boolean(v))),
  );
  const oppIds = openOppsTyped.map((o) => o.id);

  const [oppPropsRes, oppAssignsRes, oppTpsRes] = await Promise.all([
    oppPropertyIds.length > 0
      ? supabase
          .from("properties")
          .select("id,name,address_line1,city,state")
          .in("id", oppPropertyIds)
      : Promise.resolve({ data: [] as { id: string; name: string | null; address_line1: string; city: string | null; state: string | null }[] }),
    oppIds.length > 0
      ? supabase
          .from("opportunity_assignments")
          .select("opportunity_id,user_id,is_primary,assignment_role")
          .in("opportunity_id", oppIds)
      : Promise.resolve({ data: [] as { opportunity_id: string; user_id: string; is_primary: boolean; assignment_role: string | null }[] }),
    oppAccountIds.length > 0
      ? supabase
          .from("touchpoints")
          .select("account_id,happened_at")
          .in("account_id", oppAccountIds)
          .order("happened_at", { ascending: false })
      : Promise.resolve({ data: [] as { account_id: string; happened_at: string }[] }),
  ]);

  // ── Build TopAccount[] ─────────────────────────────────────────────────

  const accountById = new Map<string, string | null>();
  for (const a of accountsRes.data ?? []) {
    accountById.set(a.id as string, a.name as string | null);
  }

  const tpCountByAccount = new Map<string, number>();
  for (const tp of recentTpsRes.data ?? []) {
    const aid = tp.account_id as string;
    tpCountByAccount.set(aid, (tpCountByAccount.get(aid) ?? 0) + 1);
  }

  const topAccounts: TopAccount[] = Array.from(tpCountByAccount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([accountId, count]) => ({
      accountId,
      accountName: accountById.get(accountId) ?? accountId.slice(0, 8),
      touchpointCount30d: count,
    }));

  // ── Build PipelineRow[] + PipelineSummary ──────────────────────────────

  const stageNameById = new Map<string, string>();
  for (const s of stagesRes.data ?? []) {
    stageNameById.set(s.id as string, s.name as string);
  }

  type PropertyLite = { id: string; name: string | null; address_line1: string; city: string | null; state: string | null };
  const propertyById = new Map<string, PropertyLite>();
  for (const p of (oppPropsRes.data ?? []) as PropertyLite[]) {
    propertyById.set(p.id, p);
  }

  // Primary rep per opportunity: prefer is_primary, fall back to assignment_role='primary_rep'
  type Assign = { opportunity_id: string; user_id: string; is_primary: boolean; assignment_role: string | null };
  const repByOppId = new Map<string, string>();
  for (const a of (oppAssignsRes.data ?? []) as Assign[]) {
    if (a.is_primary && !repByOppId.has(a.opportunity_id)) {
      repByOppId.set(a.opportunity_id, a.user_id);
    }
  }
  for (const a of (oppAssignsRes.data ?? []) as Assign[]) {
    if (!repByOppId.has(a.opportunity_id) && a.assignment_role === "primary_rep") {
      repByOppId.set(a.opportunity_id, a.user_id);
    }
  }

  const repNameByUserId = new Map<string, string>();
  for (const m of orgUserRows) {
    const name = (m.full_name as string | null)?.trim() || (m.email as string | null)?.split("@")[0] || (m.user_id as string).slice(0, 8);
    repNameByUserId.set(m.user_id as string, name);
  }

  // Latest happened_at per account (touchpoints already ordered DESC)
  const lastActivityByAccount = new Map<string, string>();
  for (const tp of (oppTpsRes.data ?? []) as { account_id: string; happened_at: string }[]) {
    if (!lastActivityByAccount.has(tp.account_id)) {
      lastActivityByAccount.set(tp.account_id, tp.happened_at);
    }
  }

  function classifyHealth(daysSince: number | null): PipelineHealth {
    if (daysSince === null) return "no_activity";
    if (daysSince <= 7) return "active";
    if (daysSince <= 21) return "cooling";
    return "stalled";
  }

  const pipelineRows: PipelineRow[] = openOppsTyped.map((o) => {
    const lastAt = o.account_id ? lastActivityByAccount.get(o.account_id) ?? null : null;
    const daysSince = lastAt ? Math.floor((nowMs - new Date(lastAt).getTime()) / 86400000) : null;
    const daysInStage = Math.floor((nowMs - new Date(o.updated_at).getTime()) / 86400000);
    const prop = o.property_id ? propertyById.get(o.property_id) ?? null : null;
    const propAddress = prop
      ? [prop.address_line1, prop.city, prop.state].filter(Boolean).join(", ")
      : "";
    const repUserId = repByOppId.get(o.id) ?? null;
    return {
      oppId: o.id,
      oppTitle: o.title,
      estimatedValue: o.estimated_value,
      stageName: stageNameById.get(o.stage_id) ?? "—",
      accountId: o.account_id,
      accountName: (o.account_id ? accountById.get(o.account_id) : null) ?? "—",
      propertyId: o.property_id,
      propertyName: prop?.name ?? null,
      propertyAddress: propAddress,
      repName: repUserId ? repNameByUserId.get(repUserId) ?? null : null,
      daysInStage,
      lastActivityAt: lastAt,
      daysSinceActivity: daysSince,
      health: classifyHealth(daysSince),
    };
  });

  // Sort: NoActivity → Stalled → Cooling → Active. Within each, days-since-activity DESC.
  const HEALTH_ORDER: Record<PipelineHealth, number> = {
    no_activity: 0,
    stalled: 1,
    cooling: 2,
    active: 3,
  };
  pipelineRows.sort((a, b) => {
    const hcmp = HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health];
    if (hcmp !== 0) return hcmp;
    const ad = a.daysSinceActivity ?? Number.POSITIVE_INFINITY;
    const bd = b.daysSinceActivity ?? Number.POSITIVE_INFINITY;
    return bd - ad;
  });

  const pipelineSummary: PipelineSummary = {
    totalValue: pipelineRows.reduce((s, r) => s + (r.estimatedValue ?? 0), 0),
    activeCount: pipelineRows.filter((r) => r.health === "active").length,
    coolingCount: pipelineRows.filter((r) => r.health === "cooling").length,
    stalledCount: pipelineRows.filter((r) => r.health === "stalled").length,
    noActivityCount: pipelineRows.filter((r) => r.health === "no_activity").length,
  };

  // ── Org monthly revenue target (for Pipeline Health coverage line) ────
  const monthlyDefRes = await supabase
    .from("kpi_definitions")
    .select("id")
    .eq("key", "monthly_revenue_target")
    .is("org_id", null)
    .maybeSingle();
  const monthlyRevenueDefId = (monthlyDefRes.data?.id as string | undefined) ?? null;

  let monthlyRevenueTarget: number | null = null;
  let monthlyRevenueTargetId: string | null = null;
  if (monthlyRevenueDefId) {
    const targetRes = await supabase
      .from("kpi_targets")
      .select("id,target_value")
      .eq("kpi_definition_id", monthlyRevenueDefId)
      .eq("period", "monthly")
      .is("user_id", null)
      .maybeSingle();
    if (targetRes.data) {
      monthlyRevenueTarget = Number(targetRes.data.target_value);
      monthlyRevenueTargetId = targetRes.data.id as string;
    }
  }

  // ── Build queue counts per rep ──────────────────────────────────────────
  const { data: queueData } = await supabase
    .from("suggested_outreach")
    .select("user_id,prospect_id")
    .eq("status", "new");
  const queueCounts = new Map<string, number>();
  for (const row of queueData ?? []) {
    const uid = row.user_id as string;
    queueCounts.set(uid, (queueCounts.get(uid) ?? 0) + 1);
  }
  const queueCountsObj: Record<string, number> = Object.fromEntries(queueCounts);

  // ── Count unassigned agent prospects (no suggested_outreach record) ────
  const { data: allAgentProspects } = await supabase
    .from("prospects")
    .select("id")
    .eq("source", "agent")
    .neq("status", "dismissed");

  const assignedProspectIds = new Set(
    (queueData ?? []).map((r) => r.prospect_id as string)
  );
  // Also fetch all suggested_outreach prospect_ids (not just 'new')
  const { data: allSoData } = await supabase
    .from("suggested_outreach")
    .select("prospect_id");
  const allAssignedIds = new Set(
    (allSoData ?? []).map((r) => r.prospect_id as string)
  );

  const unassignedCount = (allAgentProspects ?? []).filter(
    (p) => !allAssignedIds.has(p.id as string)
  ).length;

  // Check if ICP is configured
  const { count: icpCount } = await supabase
    .from("icp_profiles")
    .select("id", { count: "exact", head: true })
    .eq("active", true);

  return (
    <ManagerClient
      repStats={repStats}
      stageSummaries={stageSummaries}
      topAccounts={topAccounts}
      pipelineRows={pipelineRows}
      pipelineSummary={pipelineSummary}
      orgId={orgId}
      monthlyRevenueDefId={monthlyRevenueDefId}
      monthlyRevenueTarget={monthlyRevenueTarget}
      monthlyRevenueTargetId={monthlyRevenueTargetId}
      queueCounts={queueCountsObj}
      unassignedProspectCount={unassignedCount}
      hasIcp={(icpCount ?? 0) > 0}
      generatedAt={now.toISOString()}
    />
  );
}
