import { requireServerOrgContext } from "@/lib/supabase/server-org";

export default async function AccountsPage() {
  const { supabase, orgId } = await requireServerOrgContext();

  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("id,name,account_type,status,updated_at")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(250);

  if (error) throw new Error(error.message);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Accounts</h1>
        <p className="text-sm text-slate-600">Showing active accounts in your organization.</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        {!accounts?.length ? (
          <p className="text-sm text-slate-600">No accounts found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} className="border-b border-slate-100 text-slate-700">
                    <td className="px-2 py-2 font-medium text-slate-900">{account.name}</td>
                    <td className="px-2 py-2">{account.account_type || "-"}</td>
                    <td className="px-2 py-2">{account.status || "-"}</td>
                    <td className="px-2 py-2">
                      {account.updated_at ? new Date(account.updated_at).toLocaleString() : "-"}
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
