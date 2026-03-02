import { requireServerOrgContext } from "@/lib/supabase/server-org";

type AccountRow = {
  id: string;
  name: string;
};

export default async function PropertiesPage() {
  const { supabase, orgId } = await requireServerOrgContext();

  const [propertiesResult, accountsResult] = await Promise.all([
    supabase
      .from("properties")
      .select("id,address_line1,city,state,postal_code,primary_account_id,updated_at")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(250),
    supabase
      .from("accounts")
      .select("id,name")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .limit(500),
  ]);

  if (propertiesResult.error) throw new Error(propertiesResult.error.message);
  if (accountsResult.error) throw new Error(accountsResult.error.message);

  const accountsById = new Map<string, string>();
  for (const account of (accountsResult.data ?? []) as AccountRow[]) {
    accountsById.set(account.id, account.name);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Properties</h1>
        <p className="text-sm text-slate-600">Showing active properties in your organization.</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        {!propertiesResult.data?.length ? (
          <p className="text-sm text-slate-600">No properties found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2 font-medium">Address</th>
                  <th className="px-2 py-2 font-medium">City</th>
                  <th className="px-2 py-2 font-medium">State</th>
                  <th className="px-2 py-2 font-medium">Postal</th>
                  <th className="px-2 py-2 font-medium">Primary Account</th>
                  <th className="px-2 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {propertiesResult.data.map((property) => (
                  <tr key={property.id} className="border-b border-slate-100 text-slate-700">
                    <td className="px-2 py-2 font-medium text-slate-900">{property.address_line1}</td>
                    <td className="px-2 py-2">{property.city}</td>
                    <td className="px-2 py-2">{property.state}</td>
                    <td className="px-2 py-2">{property.postal_code}</td>
                    <td className="px-2 py-2">
                      {property.primary_account_id
                        ? accountsById.get(property.primary_account_id) || "Unknown account"
                        : "-"}
                    </td>
                    <td className="px-2 py-2">
                      {property.updated_at ? new Date(property.updated_at).toLocaleString() : "-"}
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
