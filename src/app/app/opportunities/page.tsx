import { requireServerOrgContext } from "@/lib/supabase/server-org";
import OpportunitiesClient from "@/app/app/opportunities/opportunities-client";

export type OppRow = {
  id: string;
  title: string | null;
  status: string;
  estimated_value: number | null;
  stage_id: string;
  stage_name: string;
  scope_type_id: string | null;
  scope_name: string | null;
  property_id: string | null;
  property_label: string | null;
  account_id: string | null;
  account_name: string | null;
  primary_contact_id: string | null;
  opened_at: string;
  closed_at: string | null;
  updated_at: string;
  created_by: string | null;
  primary_rep_user_id: string | null;
};

export type Stage = {
  id: string;
  name: string;
  key: string;
  sort_order: number;
  is_closed_stage: boolean;
};

export type ScopeType = { id: string; name: string; key: string };
export type PropertyOption = { id: string; name: string | null; address_line1: string; city: string | null; state: string | null; primary_account_id: string | null };
export type AccountOption = { id: string; name: string | null };
export type OrgUser = { user_id: string; role: string };

export default async function OpportunitiesPage() {
  const { supabase, userId, orgId } = await requireServerOrgContext();

  const [oppsRes, propsRes, accountsRes, stagesRes, scopeRes, assignmentsRes, orgUsersRes, meRes] =
    await Promise.all([
      supabase
        .from("opportunities")
        .select(
          "id,title,status,estimated_value,stage_id,scope_type_id,property_id,account_id,primary_contact_id,opened_at,closed_at,updated_at,created_by",
        )
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(500),
      supabase
        .from("properties")
        .select("id,name,address_line1,city,state,primary_account_id")
        .is("deleted_at", null)
        .limit(500),
      supabase.from("accounts").select("id,name").is("deleted_at", null).limit(500),
      supabase.from("opportunity_stages").select("id,name,key,sort_order,is_closed_stage,org_id").order("sort_order"),
      supabase.from("scope_types").select("id,name,key,org_id").order("sort_order"),
      supabase.from("opportunity_assignments").select("opportunity_id,user_id,is_primary"),
      supabase.from("org_users").select("user_id,role,full_name,email").limit(200),
      supabase.from("org_users").select("role").eq("user_id", userId).maybeSingle(),
    ]);

  if (oppsRes.error) throw new Error(oppsRes.error.message);

  // Build lookup maps
  const propertiesById = new Map<string, PropertyOption>();
  for (const p of propsRes.data ?? []) {
    propertiesById.set(p.id as string, {
      id: p.id as string,
      name: p.name as string | null,
      address_line1: p.address_line1 as string,
      city: p.city as string | null,
      state: p.state as string | null,
      primary_account_id: p.primary_account_id as string | null,
    });
  }

  const accountsById = new Map<string, string | null>();
  for (const a of accountsRes.data ?? []) {
    accountsById.set(a.id as string, a.name as string | null);
  }

  const stagesById = new Map<string, Stage>();
  for (const s of stagesRes.data ?? []) {
    stagesById.set(s.id as string, s as unknown as Stage);
  }

  const scopeTypesById = new Map<string, ScopeType>();
  for (const sc of scopeRes.data ?? []) {
    scopeTypesById.set(sc.id as string, sc as unknown as ScopeType);
  }

  const primaryRepByOppId = new Map<string, string>();
  for (const a of assignmentsRes.data ?? []) {
    if (a.is_primary) {
      primaryRepByOppId.set(a.opportunity_id as string, a.user_id as string);
    }
  }

  function propertyLabel(prop: PropertyOption | undefined): string | null {
    if (!prop) return null;
    const addr = [prop.address_line1, prop.city, prop.state].filter(Boolean).join(", ");
    if (prop.name && prop.name !== prop.address_line1) return `${prop.name} — ${addr}`;
    return addr;
  }

  const rows: OppRow[] = (oppsRes.data ?? []).map((o) => {
    const prop = o.property_id ? propertiesById.get(o.property_id as string) : undefined;
    const stage = stagesById.get(o.stage_id as string);
    const scope = o.scope_type_id ? scopeTypesById.get(o.scope_type_id as string) : undefined;
    return {
      id: o.id as string,
      title: o.title as string | null,
      status: o.status as string,
      estimated_value: o.estimated_value as number | null,
      stage_id: o.stage_id as string,
      stage_name: stage?.name ?? "Unknown",
      scope_type_id: o.scope_type_id as string | null,
      scope_name: scope?.name ?? null,
      property_id: o.property_id as string | null,
      property_label: propertyLabel(prop),
      account_id: o.account_id as string | null,
      account_name: o.account_id ? (accountsById.get(o.account_id as string) ?? null) : null,
      primary_contact_id: o.primary_contact_id as string | null,
      opened_at: o.opened_at as string,
      closed_at: o.closed_at as string | null,
      updated_at: o.updated_at as string,
      created_by: o.created_by as string | null,
      primary_rep_user_id: primaryRepByOppId.get(o.id as string) ?? null,
    };
  });

  // Config tables hold both org-specific and global (org_id = null) rows. An org
  // that has customized its own stages/scopes uses ONLY those; otherwise it falls
  // back to the global defaults. (Name-resolution maps above intentionally keep
  // ALL rows so existing opportunities resolve regardless of which set they used.)
  function pickOrgOrGlobal<T extends { org_id?: string | null }>(rows: T[]): T[] {
    const orgRows = rows.filter((r) => r.org_id === orgId);
    return orgRows.length > 0 ? orgRows : rows.filter((r) => r.org_id == null);
  }

  const stages: Stage[] = pickOrgOrGlobal((stagesRes.data ?? []) as (Stage & { org_id: string | null })[]).map(
    (s) => s as unknown as Stage,
  );
  const scopeTypes: ScopeType[] = pickOrgOrGlobal((scopeRes.data ?? []) as (ScopeType & { org_id: string | null })[]).map(
    (s) => s as unknown as ScopeType,
  );
  const properties: PropertyOption[] = Array.from(propertiesById.values());
  const accountOptions: AccountOption[] = (accountsRes.data ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string | null,
  }));
  const orgUsers: OrgUser[] = (orgUsersRes.data ?? []).map((u) => ({
    user_id: u.user_id as string,
    role: u.role as string,
  }));
  const reps = (orgUsersRes.data ?? []).map((u) => ({
    userId: u.user_id as string,
    name: ((u as { full_name?: string | null }).full_name ?? "")?.trim() || ((u as { email?: string | null }).email ?? "")?.split("@")[0] || (u.user_id as string).slice(0, 8),
  }));

  return (
    <OpportunitiesClient
      opportunities={rows}
      reps={reps}
      stages={stages}
      scopeTypes={scopeTypes}
      properties={properties}
      accounts={accountOptions}
      orgUsers={orgUsers}
      orgId={orgId}
      userId={userId}
      userRole={meRes.data?.role ?? "rep"}
    />
  );
}
