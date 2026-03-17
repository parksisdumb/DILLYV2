import { redirect } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import AnalyticsClient from "./analytics-client";

// ── Types passed to client ──────────────────────────────────────────────────

export type AnalyticsTouchpoint = {
  id: string;
  happened_at: string;
  type_key: string;
  is_outreach: boolean;
  outcome_key: string | null;
  engagement_phase: string;
  rep_user_id: string;
  contact_id: string | null;
  account_id: string | null;
  property_id: string | null;
};

export type AnalyticsOpportunity = {
  id: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  estimated_value: number | null;
  final_value: number | null;
  created_by: string | null;
  property_id: string;
  title: string | null;
  account_name: string | null;
  last_touchpoint_at: string | null;
};

export type AnalyticsNextAction = {
  id: string;
  status: string;
  due_at: string;
  updated_at: string;
  assigned_user_id: string;
};

export type RepInfo = {
  id: string;
  name: string;
};

export type BenchmarkMap = Record<
  string,
  { metric_value: Record<string, unknown>; sample_size: number }
>;

export type AnalyticsData = {
  reps: RepInfo[];
  touchpoints: AnalyticsTouchpoint[];
  opportunities: AnalyticsOpportunity[];
  nextActions: AnalyticsNextAction[];
  prospectCounts: { total: number; converted: number };
  platformBenchmarks: BenchmarkMap;
  orgBenchmarks: BenchmarkMap;
};

// ── Server Component ────────────────────────────────────────────────────────

export default async function AnalyticsPage() {
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

  const twelveMonthsAgo = new Date(
    Date.now() - 365 * 86400000
  ).toISOString();

  // Parallel fetch all data
  const [
    orgUsersRes,
    touchpointTypesRes,
    touchpointOutcomesRes,
    touchpointsRes,
    opportunitiesRes,
    nextActionsRes,
    prospectsRes,
    prospectsConvertedRes,
    platformBenchRes,
    orgBenchRes,
  ] = await Promise.all([
    supabase
      .from("org_users")
      .select("user_id,full_name,email,role")
      .order("full_name"),
    supabase.from("touchpoint_types").select("id,key,is_outreach"),
    supabase.from("touchpoint_outcomes").select("id,key"),
    supabase
      .from("touchpoints")
      .select(
        "id,happened_at,touchpoint_type_id,outcome_id,engagement_phase,rep_user_id,contact_id,account_id,property_id"
      )
      .gte("happened_at", twelveMonthsAgo)
      .order("happened_at", { ascending: false })
      .limit(50000),
    supabase
      .from("opportunities")
      .select(
        "id,status,opened_at,closed_at,estimated_value,final_value,created_by,property_id,title"
      )
      .gte("opened_at", twelveMonthsAgo)
      .limit(10000),
    supabase
      .from("next_actions")
      .select("id,status,due_at,updated_at,assigned_user_id")
      .gte("due_at", twelveMonthsAgo)
      .limit(50000),
    supabase
      .from("prospects")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .eq("status", "converted"),
    supabase
      .from("benchmark_snapshots")
      .select("metric_key,metric_value,sample_size")
      .is("org_id", null)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("benchmark_snapshots")
      .select("metric_key,metric_value,sample_size")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  // Build lookup maps
  const typeMap = new Map(
    (touchpointTypesRes.data ?? []).map((t) => [
      t.id as string,
      { key: t.key as string, is_outreach: t.is_outreach as boolean },
    ])
  );
  const outcomeMap = new Map(
    (touchpointOutcomesRes.data ?? []).map((o) => [
      o.id as string,
      o.key as string,
    ])
  );

  // Reps
  const reps: RepInfo[] = (orgUsersRes.data ?? []).map((u) => ({
    id: u.user_id as string,
    name: (u.full_name as string) || (u.email as string) || (u.user_id as string).slice(0, 8),
  }));

  // Enrich touchpoints
  const touchpoints: AnalyticsTouchpoint[] = (touchpointsRes.data ?? []).map(
    (t) => {
      const typeInfo = typeMap.get(t.touchpoint_type_id as string);
      return {
        id: t.id as string,
        happened_at: t.happened_at as string,
        type_key: typeInfo?.key ?? "unknown",
        is_outreach: typeInfo?.is_outreach ?? false,
        outcome_key: t.outcome_id
          ? outcomeMap.get(t.outcome_id as string) ?? null
          : null,
        engagement_phase: (t.engagement_phase as string) || "first_touch",
        rep_user_id: t.rep_user_id as string,
        contact_id: t.contact_id as string | null,
        account_id: t.account_id as string | null,
        property_id: t.property_id as string | null,
      };
    }
  );

  // Compute last touchpoint per property for open opportunities
  const lastTouchByProperty = new Map<string, string>();
  for (const t of touchpoints) {
    if (!t.property_id) continue;
    const existing = lastTouchByProperty.get(t.property_id);
    if (!existing || t.happened_at > existing) {
      lastTouchByProperty.set(t.property_id, t.happened_at);
    }
  }

  // Get account names for opportunities
  const propertyIds = [
    ...new Set(
      (opportunitiesRes.data ?? []).map((o) => o.property_id as string)
    ),
  ];
  let accountNameMap = new Map<string, string>();
  if (propertyIds.length > 0) {
    const { data: props } = await supabase
      .from("properties")
      .select("id,primary_account_id")
      .in("id", propertyIds.slice(0, 500));
    const accountIds = [
      ...new Set(
        (props ?? [])
          .map((p) => p.primary_account_id as string | null)
          .filter(Boolean)
      ),
    ] as string[];
    if (accountIds.length > 0) {
      const { data: accounts } = await supabase
        .from("accounts")
        .select("id,name")
        .in("id", accountIds.slice(0, 500));
      const acctMap = new Map(
        (accounts ?? []).map((a) => [a.id as string, a.name as string])
      );
      const propAcctMap = new Map(
        (props ?? []).map((p) => [
          p.id as string,
          p.primary_account_id as string | null,
        ])
      );
      accountNameMap = new Map(
        propertyIds
          .map((pid) => {
            const acctId = propAcctMap.get(pid);
            return [pid, acctId ? acctMap.get(acctId) ?? null : null] as const;
          })
          .filter(([, v]) => v !== null) as [string, string][]
      );
    }
  }

  const opportunities: AnalyticsOpportunity[] = (
    opportunitiesRes.data ?? []
  ).map((o) => ({
    id: o.id as string,
    status: o.status as string,
    opened_at: o.opened_at as string,
    closed_at: o.closed_at as string | null,
    estimated_value: o.estimated_value as number | null,
    final_value: o.final_value as number | null,
    created_by: o.created_by as string | null,
    property_id: o.property_id as string,
    title: o.title as string | null,
    account_name: accountNameMap.get(o.property_id as string) ?? null,
    last_touchpoint_at:
      lastTouchByProperty.get(o.property_id as string) ?? null,
  }));

  const nextActions: AnalyticsNextAction[] = (
    nextActionsRes.data ?? []
  ).map((n) => ({
    id: n.id as string,
    status: n.status as string,
    due_at: n.due_at as string,
    updated_at: n.updated_at as string,
    assigned_user_id: n.assigned_user_id as string,
  }));

  // Benchmarks
  const platformBenchmarks: BenchmarkMap = {};
  for (const b of platformBenchRes.data ?? []) {
    const key = b.metric_key as string;
    if (!platformBenchmarks[key]) {
      platformBenchmarks[key] = {
        metric_value: b.metric_value as Record<string, unknown>,
        sample_size: b.sample_size as number,
      };
    }
  }
  const orgBenchmarks: BenchmarkMap = {};
  for (const b of orgBenchRes.data ?? []) {
    const key = b.metric_key as string;
    if (!orgBenchmarks[key]) {
      orgBenchmarks[key] = {
        metric_value: b.metric_value as Record<string, unknown>,
        sample_size: b.sample_size as number,
      };
    }
  }

  const analyticsData: AnalyticsData = {
    reps,
    touchpoints,
    opportunities,
    nextActions,
    prospectCounts: {
      total: prospectsRes.count ?? 0,
      converted: prospectsConvertedRes.count ?? 0,
    },
    platformBenchmarks,
    orgBenchmarks,
  };

  return <AnalyticsClient data={analyticsData} />;
}
