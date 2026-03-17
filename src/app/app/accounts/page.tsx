import { requireServerOrgContext } from "@/lib/supabase/server-org";
import AccountsClient from "@/app/app/accounts/accounts-client";

type AccountRow = {
  id: string;
  name: string | null;
  account_type: string | null;
  status: string;
  notes: string | null;
  website: string | null;
  phone: string | null;
  updated_at: string;
  created_by: string | null;
  contact_count: number;
  opportunity_count: number;
  last_touch_at: string | null;
};

export default async function AccountsPage() {
  const { supabase, userId, orgId } = await requireServerOrgContext();

  const [acctRes, contactRes, tpRes, oppRes, meRes, propsRes] = await Promise.all([
    supabase
      .from("accounts")
      .select("id,name,account_type,status,notes,website,phone,updated_at,created_by")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(500),
    supabase.from("contacts").select("account_id").is("deleted_at", null),
    supabase
      .from("touchpoints")
      .select("account_id,happened_at")
      .not("account_id", "is", null),
    supabase.from("opportunities").select("account_id").not("account_id", "is", null),
    supabase.from("org_users").select("role").eq("user_id", userId).maybeSingle(),
    supabase.from("properties").select("id,address_line1,city,state,postal_code").is("deleted_at", null).order("address_line1"),
  ]);

  const firstError = [acctRes.error, contactRes.error, tpRes.error, oppRes.error, propsRes.error].find(Boolean);
  if (firstError) throw new Error(firstError.message);

  // Build lookup maps
  const contactsByAccount = new Map<string, number>();
  for (const c of contactRes.data ?? []) {
    const id = c.account_id as string;
    if (id) contactsByAccount.set(id, (contactsByAccount.get(id) ?? 0) + 1);
  }

  const lastTouchByAccount = new Map<string, string>();
  for (const tp of tpRes.data ?? []) {
    const id = tp.account_id as string;
    const existing = lastTouchByAccount.get(id);
    const happenedAt = tp.happened_at as string;
    if (!existing || happenedAt > existing) lastTouchByAccount.set(id, happenedAt);
  }

  const oppsByAccount = new Map<string, number>();
  for (const o of oppRes.data ?? []) {
    const id = o.account_id as string;
    if (id) oppsByAccount.set(id, (oppsByAccount.get(id) ?? 0) + 1);
  }

  const rows: AccountRow[] = (acctRes.data ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string | null,
    account_type: a.account_type as string | null,
    status: (a.status as string) ?? "active",
    notes: a.notes as string | null,
    website: (a as Record<string, unknown>).website as string | null ?? null,
    phone: (a as Record<string, unknown>).phone as string | null ?? null,
    updated_at: a.updated_at as string,
    created_by: a.created_by as string | null,
    contact_count: contactsByAccount.get(a.id as string) ?? 0,
    opportunity_count: oppsByAccount.get(a.id as string) ?? 0,
    last_touch_at: lastTouchByAccount.get(a.id as string) ?? null,
  }));

  const userRole = meRes.data?.role ?? "rep";

  const allProperties = (propsRes.data ?? []).map((p) => ({
    id: p.id as string,
    address_line1: p.address_line1 as string,
    city: p.city as string | null,
    state: p.state as string | null,
    postal_code: p.postal_code as string | null,
  }));

  return (
    <AccountsClient
      accounts={rows}
      orgId={orgId}
      userId={userId}
      userRole={userRole}
      allProperties={allProperties}
    />
  );
}
