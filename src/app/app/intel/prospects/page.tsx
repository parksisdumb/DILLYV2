import { redirect } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import { createAdminClient } from "@/lib/supabase/admin";
import ProspectsClient from "./prospects-client";

export type IntelProspectRow = {
  id: string;
  company_name: string;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  source_detail: string;
  confidence_score: number;
  status: string;
  account_type: string | null;
  building_type: string | null;
  created_at: string;
};

export type TerritoryMatchInfo = {
  totalMatching: number;
  cities: string[];
  states: string[];
};

export default async function IntelProspectsPage() {
  const { supabase, userId, orgId } = await requireServerOrgContext();

  const { data: orgUser } = await supabase
    .from("org_users")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (!orgUser || !["manager", "admin"].includes(orgUser.role)) {
    redirect("/app");
  }

  const admin = createAdminClient();

  // Fetch territory regions for this org to compute match count
  const { data: territories } = await supabase
    .from("territories")
    .select("id");

  const territoryIds = (territories ?? []).map((t) => t.id as string);

  let orgCities: string[] = [];
  let orgStates: string[] = [];
  if (territoryIds.length > 0) {
    const { data: regions } = await supabase
      .from("territory_regions")
      .select("region_type,region_value,state")
      .in("territory_id", territoryIds);

    for (const r of regions ?? []) {
      if ((r.region_type as string) === "city") {
        orgCities.push((r.region_value as string).toLowerCase());
      }
      orgStates.push((r.state as string).toLowerCase());
    }
    orgCities = [...new Set(orgCities)];
    orgStates = [...new Set(orgStates)];
  }

  // Parallel fetch: all prospects + source breakdown
  const [prospectsRes, sourcesRes] = await Promise.all([
    admin
      .from("intel_prospects")
      .select(
        "id,company_name,address_line1,city,state,postal_code,source_detail,confidence_score,status,account_type,building_type,created_at"
      )
      .eq("status", "active")
      .order("confidence_score", { ascending: false })
      .limit(2000),
    admin
      .from("intel_prospects")
      .select("source_detail")
      .eq("status", "active"),
  ]);

  const rows: IntelProspectRow[] = (prospectsRes.data ?? []).map((r) => ({
    id: r.id as string,
    company_name: r.company_name as string,
    address_line1: r.address_line1 as string | null,
    city: r.city as string | null,
    state: r.state as string | null,
    postal_code: r.postal_code as string | null,
    source_detail: r.source_detail as string,
    confidence_score: r.confidence_score as number,
    status: r.status as string,
    account_type: r.account_type as string | null,
    building_type: r.building_type as string | null,
    created_at: r.created_at as string,
  }));

  // Compute territory match count
  const matchingRows = rows.filter((r) => {
    const pCity = r.city?.toLowerCase();
    const pState = r.state?.toLowerCase();
    if (orgCities.length > 0 && pCity && orgCities.includes(pCity)) return true;
    if (orgStates.length > 0 && pState && orgStates.includes(pState)) return true;
    return false;
  });

  // Source options for filter
  const sourceSet = new Set<string>();
  for (const s of sourcesRes.data ?? []) {
    sourceSet.add(s.source_detail as string);
  }

  // State options
  const stateSet = new Set<string>();
  for (const r of rows) {
    if (r.state) stateSet.add(r.state.toUpperCase());
  }

  return (
    <ProspectsClient
      prospects={rows}
      sources={[...sourceSet].sort()}
      states={[...stateSet].sort()}
      territoryMatch={{
        totalMatching: matchingRows.length,
        cities: orgCities,
        states: orgStates,
      }}
      orgId={orgId}
    />
  );
}
