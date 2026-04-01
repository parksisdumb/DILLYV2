import { redirect } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import { createAdminClient } from "@/lib/supabase/admin";
import DiscoverClient from "./discover-client";

// ── Types ────────────────────────────────────────────────────────────────────

export type IntelBusiness = {
  id: string;
  company_name: string;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  source_detail: string;
  confidence_score: number;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  account_type: string | null;
};

export type IntelEntity = {
  id: string;
  name: string;
  ticker: string | null;
  entity_type: string | null;
  markets: { name: string; state: string | null; property_count: number | null; sq_footage_sf: number | null; property_type: string }[];
  total_properties: number | null;
};

export type IntelProperty = {
  id: string;
  street_address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  property_name: string | null;
  property_type: string | null;
  sq_footage: number | null;
  owner_name: string | null;
  source_detail: string;
  confidence_score: number;
};

export type TerritoryInfo = {
  cities: string[];
  states: string[];
  hasTerritory: boolean;
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function DiscoverPage() {
  const { supabase, userId, orgId } = await requireServerOrgContext();
  const admin = createAdminClient();

  // Get user's territory assignments
  const { data: assignments } = await supabase
    .from("territory_assignments")
    .select("territory_id")
    .eq("user_id", userId);

  const territoryIds = (assignments ?? []).map((a) => a.territory_id as string);

  let cities: string[] = [];
  let states: string[] = [];

  if (territoryIds.length > 0) {
    const { data: regions } = await supabase
      .from("territory_regions")
      .select("region_type,region_value,state")
      .in("territory_id", territoryIds);

    for (const r of regions ?? []) {
      if ((r.region_type as string) === "city") {
        cities.push((r.region_value as string).toLowerCase());
      }
      states.push((r.state as string).toLowerCase());
    }
    cities = [...new Set(cities)];
    states = [...new Set(states)];
  }

  const hasTerritory = territoryIds.length > 0;

  // If no territory, return early with empty state
  if (!hasTerritory) {
    return (
      <DiscoverClient
        businesses={[]}
        entities={[]}
        properties={[]}
        territory={{ cities, states, hasTerritory }}
        orgId={orgId}
        userId={userId}
      />
    );
  }

  // Parallel fetch all three tabs
  const [businessesRes, entitiesRes, propertiesRes] = await Promise.all([
    // Tab 1: Businesses from intel_prospects
    admin
      .from("intel_prospects")
      .select(
        "id,company_name,address_line1,city,state,postal_code,source_detail,confidence_score,contact_first_name,contact_last_name,contact_title,contact_email,contact_phone,account_type"
      )
      .neq("status", "converted")
      .order("confidence_score", { ascending: false })
      .limit(500),

    // Tab 2: Entities from intel_entities
    admin
      .from("intel_entities")
      .select("id,name,ticker,entity_type,portfolio_summary")
      .eq("enabled", true)
      .order("name")
      .limit(200),

    // Tab 3: Properties from intel_properties
    admin
      .from("intel_properties")
      .select(
        "id,street_address,city,state,postal_code,property_name,property_type,sq_footage,owner_name,source_detail,confidence_score"
      )
      .eq("is_active", true)
      .order("confidence_score", { ascending: false })
      .limit(500),
  ]);

  // Filter businesses by territory (case-insensitive)
  const businesses: IntelBusiness[] = (businessesRes.data ?? [])
    .filter((b) => {
      const bCity = (b.city as string | null)?.toLowerCase();
      const bState = (b.state as string | null)?.toLowerCase();
      return (bCity && cities.includes(bCity)) || (bState && states.includes(bState));
    })
    .slice(0, 100)
    .map((b) => ({
      id: b.id as string,
      company_name: b.company_name as string,
      address_line1: b.address_line1 as string | null,
      city: b.city as string | null,
      state: b.state as string | null,
      postal_code: b.postal_code as string | null,
      source_detail: b.source_detail as string,
      confidence_score: b.confidence_score as number,
      contact_first_name: b.contact_first_name as string | null,
      contact_last_name: b.contact_last_name as string | null,
      contact_title: b.contact_title as string | null,
      contact_email: b.contact_email as string | null,
      contact_phone: b.contact_phone as string | null,
      account_type: b.account_type as string | null,
    }));

  // Filter entities by territory markets
  const entities: IntelEntity[] = (entitiesRes.data ?? [])
    .map((e) => {
      const ps = (e.portfolio_summary as Record<string, unknown>) ?? {};
      const markets = Array.isArray(ps.markets) ? ps.markets : [];
      return {
        id: e.id as string,
        name: e.name as string,
        ticker: e.ticker as string | null,
        entity_type: e.entity_type as string | null,
        markets: markets.filter((m: { state?: string; name?: string }) => {
          const mState = m.state?.toLowerCase();
          const mName = m.name?.toLowerCase();
          return (mState && states.includes(mState)) ||
            (mName && cities.some((c) => mName?.includes(c)));
        }),
        total_properties: (ps.total_properties as number) ?? null,
      };
    })
    .filter((e) => e.markets.length > 0);

  // Filter properties by territory
  const properties: IntelProperty[] = (propertiesRes.data ?? [])
    .filter((p) => {
      const pCity = (p.city as string | null)?.toLowerCase();
      const pState = (p.state as string | null)?.toLowerCase();
      return (pCity && cities.includes(pCity)) || (pState && states.includes(pState));
    })
    .slice(0, 100)
    .map((p) => ({
      id: p.id as string,
      street_address: p.street_address as string | null,
      city: p.city as string | null,
      state: p.state as string | null,
      postal_code: p.postal_code as string | null,
      property_name: p.property_name as string | null,
      property_type: p.property_type as string | null,
      sq_footage: p.sq_footage as number | null,
      owner_name: p.owner_name as string | null,
      source_detail: p.source_detail as string,
      confidence_score: p.confidence_score as number,
    }));

  return (
    <DiscoverClient
      businesses={businesses}
      entities={entities}
      properties={properties}
      territory={{ cities, states, hasTerritory }}
      orgId={orgId}
      userId={userId}
    />
  );
}
