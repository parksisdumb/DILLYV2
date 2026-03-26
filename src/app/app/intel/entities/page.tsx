import { redirect } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import { createAdminClient } from "@/lib/supabase/admin";
import EntitiesClient from "./entities-client";

export type EntityRow = {
  id: string;
  name: string;
  ticker: string | null;
  entity_type: string | null;
  sic: string | null;
  last_10k_date: string | null;
  portfolio: {
    filing_type: string | null;
    total_properties: number | null;
    markets: { name: string; state: string | null; property_count: number | null; sq_footage_sf: number | null; property_type: string }[];
    capex_annual_usd: number | null;
    subsidiaries: string[];
    decision_makers: { name: string; title: string; contact_type: string }[];
  };
  contacts: { full_name: string; title: string | null; contact_type: string }[];
};

export default async function EntitiesPage() {
  const { supabase, userId } = await requireServerOrgContext();

  const { data: orgUser } = await supabase
    .from("org_users")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (!orgUser || !["manager", "admin"].includes(orgUser.role)) {
    redirect("/app");
  }

  const admin = createAdminClient();

  const [entitiesRes, contactsRes] = await Promise.all([
    admin
      .from("intel_entities")
      .select("id,name,ticker,entity_type,sic,last_10k_date,portfolio_summary")
      .eq("enabled", true)
      .order("name")
      .limit(200),
    admin
      .from("intel_contacts")
      .select("intel_entity_id,full_name,title,contact_type")
      .eq("source_detail", "edgar_10k")
      .limit(2000),
  ]);

  const contactsByEntity = new Map<string, { full_name: string; title: string | null; contact_type: string }[]>();
  for (const c of contactsRes.data ?? []) {
    const eid = c.intel_entity_id as string;
    if (!contactsByEntity.has(eid)) contactsByEntity.set(eid, []);
    contactsByEntity.get(eid)!.push({
      full_name: c.full_name as string,
      title: c.title as string | null,
      contact_type: c.contact_type as string,
    });
  }

  const entities: EntityRow[] = (entitiesRes.data ?? []).map((e) => {
    const ps = (e.portfolio_summary as Record<string, unknown>) ?? {};
    return {
      id: e.id as string,
      name: e.name as string,
      ticker: e.ticker as string | null,
      entity_type: e.entity_type as string | null,
      sic: e.sic as string | null,
      last_10k_date: e.last_10k_date as string | null,
      portfolio: {
        filing_type: (ps.filing_type as string) ?? null,
        total_properties: (ps.total_properties as number) ?? null,
        markets: Array.isArray(ps.markets) ? ps.markets : [],
        capex_annual_usd: (ps.capex_annual_usd as number) ?? null,
        subsidiaries: Array.isArray(ps.subsidiaries) ? ps.subsidiaries : [],
        decision_makers: Array.isArray(ps.decision_makers) ? ps.decision_makers : [],
      },
      contacts: contactsByEntity.get(e.id as string) ?? [],
    };
  });

  return <EntitiesClient entities={entities} />;
}
