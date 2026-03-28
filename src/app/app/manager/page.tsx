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

// ── Page ───────────────────────────────────────────────────────────────────

export default async function ManagerPage() {
  const { supabase, userId } = await requireServerOrgContext();

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
      .select("stage_id,opened_at")
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

  return (
    <ManagerClient
      repStats={repStats}
      stageSummaries={stageSummaries}
      topAccounts={topAccounts}
      queueCounts={queueCountsObj}
      unassignedProspectCount={unassignedCount}
      generatedAt={now.toISOString()}
    />
  );
}
