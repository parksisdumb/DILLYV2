import { redirect } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import { createAdminClient } from "@/lib/supabase/admin";
import IntelClient from "./intel-client";

export type SourceBreakdown = {
  source_detail: string;
  count: number;
};

export type IntelData = {
  totalPool: number;
  sourceBreakdown: SourceBreakdown[];
  matchingCount: number;
  pushedCount: number;
  lastDistributionAt: string | null;
  hasTerritories: boolean;
};

export default async function IntelPage() {
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

  // Fetch territory regions for matching preview
  const { data: territories } = await supabase
    .from("territories")
    .select("id")
    .eq("active", true);

  const territoryIds = (territories ?? []).map((t) => t.id as string);

  let regions: { region_type: string; region_value: string; state: string }[] = [];
  if (territoryIds.length > 0) {
    const { data: r } = await supabase
      .from("territory_regions")
      .select("region_type,region_value,state")
      .in("territory_id", territoryIds);
    regions = (r ?? []) as typeof regions;
  }

  const postalCodes = regions
    .filter((r) => r.region_type === "zip")
    .map((r) => r.region_value);
  const cities = regions
    .filter((r) => r.region_type === "city")
    .map((r) => r.region_value.toLowerCase());
  const stateRegions = regions
    .filter((r) => r.region_type === "state")
    .map((r) => r.region_value.toLowerCase());
  const allStates = [
    ...new Set([
      ...regions.map((r) => r.state.toLowerCase()),
      ...stateRegions,
    ]),
  ];

  // Parallel fetches
  const [poolRes, sourceRes, pushedRes, lastDistRes] = await Promise.all([
    // Total pool count
    admin
      .from("intel_prospects")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    // Source breakdown
    admin
      .from("intel_prospects")
      .select("source_detail")
      .eq("status", "active"),
    // Already pushed to this org
    admin
      .from("intel_prospects")
      .select("id", { count: "exact", head: true })
      .eq("dilly_org_id", orgId),
    // Last distribution run
    admin
      .from("agent_runs")
      .select("completed_at")
      .eq("run_type", "distribution")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // Count matching records (geography overlap — case-insensitive)
  let matchingCount = 0;
  if (regions.length > 0) {
    const { data: candidates } = await admin
      .from("intel_prospects")
      .select("city,postal_code,state")
      .eq("status", "active")
      .gte("confidence_score", 40)
      .is("dilly_org_id", null)
      .limit(2000);

    if (candidates) {
      const citySet = new Set(cities);
      matchingCount = candidates.filter((p) => {
        const pState = (p.state as string | null)?.toLowerCase();
        const pCity = (p.city as string | null)?.toLowerCase();
        const pZip = p.postal_code as string | null;

        // State-type region: match any prospect in that state
        if (pState && stateRegions.includes(pState)) return true;

        // City/zip match requires state context
        const inState = pState && allStates.includes(pState);
        if (!inState) return false;

        return (pZip && postalCodes.includes(pZip)) || (pCity && citySet.has(pCity));
      }).length;
    }
  }

  // Source breakdown aggregation
  const sourceCounts = new Map<string, number>();
  for (const row of sourceRes.data ?? []) {
    const sd = row.source_detail as string;
    sourceCounts.set(sd, (sourceCounts.get(sd) ?? 0) + 1);
  }
  const sourceBreakdown: SourceBreakdown[] = [...sourceCounts.entries()]
    .map(([source_detail, count]) => ({ source_detail, count }))
    .sort((a, b) => b.count - a.count);

  const data: IntelData = {
    totalPool: poolRes.count ?? 0,
    sourceBreakdown,
    matchingCount,
    pushedCount: pushedRes.count ?? 0,
    lastDistributionAt: (lastDistRes.data?.completed_at as string) ?? null,
    hasTerritories: regions.length > 0,
  };

  return <IntelClient data={data} />;
}
