import { requireServerOrgContext } from "@/lib/supabase/server-org";

type PropertyRow = {
  id: string;
  address_line1: string;
  city: string | null;
  state: string | null;
};

type StageRow = {
  id: string;
  name: string;
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatValue(value: number | null) {
  return value === null ? "-" : money.format(value);
}

function propertyLabel(property: PropertyRow | undefined) {
  if (!property) return "Unknown property";
  return [property.address_line1, property.city, property.state].filter(Boolean).join(", ");
}

export default async function OpportunitiesPage() {
  const { supabase, orgId } = await requireServerOrgContext();

  const [opportunitiesResult, propertiesResult, stagesResult] = await Promise.all([
    supabase
      .from("opportunities")
      .select("id,title,status,estimated_value,bid_value,final_value,stage_id,property_id,updated_at")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(250),
    supabase
      .from("properties")
      .select("id,address_line1,city,state")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .limit(500),
    supabase
      .from("opportunity_stages")
      .select("id,name")
      .eq("org_id", orgId)
      .limit(100),
  ]);

  if (opportunitiesResult.error) throw new Error(opportunitiesResult.error.message);
  if (propertiesResult.error) throw new Error(propertiesResult.error.message);
  if (stagesResult.error) throw new Error(stagesResult.error.message);

  const propertiesById = new Map<string, PropertyRow>();
  for (const property of (propertiesResult.data ?? []) as PropertyRow[]) {
    propertiesById.set(property.id, property);
  }

  const stagesById = new Map<string, string>();
  for (const stage of (stagesResult.data ?? []) as StageRow[]) {
    stagesById.set(stage.id, stage.name);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Opportunities</h1>
        <p className="text-sm text-slate-600">Showing active opportunities in your organization.</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        {!opportunitiesResult.data?.length ? (
          <p className="text-sm text-slate-600">No opportunities found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2 font-medium">Title</th>
                  <th className="px-2 py-2 font-medium">Property</th>
                  <th className="px-2 py-2 font-medium">Stage</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Estimated</th>
                  <th className="px-2 py-2 font-medium">Bid</th>
                  <th className="px-2 py-2 font-medium">Final</th>
                  <th className="px-2 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {opportunitiesResult.data.map((opportunity) => (
                  <tr key={opportunity.id} className="border-b border-slate-100 text-slate-700">
                    <td className="px-2 py-2 font-medium text-slate-900">
                      {opportunity.title || "Untitled opportunity"}
                    </td>
                    <td className="px-2 py-2">{propertyLabel(propertiesById.get(opportunity.property_id))}</td>
                    <td className="px-2 py-2">{stagesById.get(opportunity.stage_id) || "-"}</td>
                    <td className="px-2 py-2">{opportunity.status || "-"}</td>
                    <td className="px-2 py-2">{formatValue(opportunity.estimated_value)}</td>
                    <td className="px-2 py-2">{formatValue(opportunity.bid_value)}</td>
                    <td className="px-2 py-2">{formatValue(opportunity.final_value)}</td>
                    <td className="px-2 py-2">
                      {opportunity.updated_at ? new Date(opportunity.updated_at).toLocaleString() : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
