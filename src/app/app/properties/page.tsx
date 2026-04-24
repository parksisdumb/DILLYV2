import { requireServerOrgContext } from "@/lib/supabase/server-org";
import PropertiesClient from "@/app/app/properties/properties-client";

type PropertyRow = {
  id: string;
  name: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  primary_account_id: string | null;
  primary_account_name: string | null;
  primary_contact_id: string | null;
  primary_contact_name: string | null;
  open_opportunity_count: number;
  roof_type: string | null;
  roof_age_years: number | null;
  sq_footage: number | null;
  building_type: string | null;
  website: string | null;
  notes: string | null;
  updated_at: string;
};

export type AccountOption = { id: string; name: string | null };
export type ContactOption = { id: string; full_name: string | null };

export default async function PropertiesPage() {
  const { supabase, userId, orgId } = await requireServerOrgContext();

  const [propsRes, accountsRes, contactsRes, oppsRes, meRes] = await Promise.all([
    supabase
      .from("properties")
      .select(
        "id,name,address_line1,address_line2,city,state,postal_code,primary_account_id,primary_contact_id,roof_type,roof_age_years,sq_footage,building_type,website,notes,updated_at",
      )
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(500),
    supabase.from("accounts").select("id,name").is("deleted_at", null).order("name").limit(500),
    supabase.from("contacts").select("id,full_name").is("deleted_at", null).limit(500),
    supabase.from("opportunities").select("property_id").eq("status", "open"),
    supabase.from("org_users").select("role").eq("user_id", userId).maybeSingle(),
  ]);

  if (propsRes.error) throw new Error(propsRes.error.message);

  // Build lookup maps
  const accountsById = new Map<string, string | null>();
  for (const a of accountsRes.data ?? []) {
    accountsById.set(a.id as string, a.name as string | null);
  }

  const contactsById = new Map<string, string | null>();
  for (const c of contactsRes.data ?? []) {
    contactsById.set(c.id as string, c.full_name as string | null);
  }

  const oppCountByProperty = new Map<string, number>();
  for (const o of oppsRes.data ?? []) {
    const pid = o.property_id as string;
    oppCountByProperty.set(pid, (oppCountByProperty.get(pid) ?? 0) + 1);
  }

  const rows: PropertyRow[] = (propsRes.data ?? []).map((p) => ({
    id: p.id as string,
    name: (p.name as string | null) ?? null,
    address_line1: p.address_line1 as string,
    address_line2: p.address_line2 as string | null,
    city: p.city as string,
    state: p.state as string,
    postal_code: p.postal_code as string,
    primary_account_id: p.primary_account_id as string | null,
    primary_account_name: p.primary_account_id
      ? (accountsById.get(p.primary_account_id as string) ?? null)
      : null,
    primary_contact_id: p.primary_contact_id as string | null,
    primary_contact_name: p.primary_contact_id
      ? (contactsById.get(p.primary_contact_id as string) ?? null)
      : null,
    open_opportunity_count: oppCountByProperty.get(p.id as string) ?? 0,
    roof_type: p.roof_type as string | null,
    roof_age_years: p.roof_age_years as number | null,
    sq_footage: p.sq_footage as number | null,
    building_type: p.building_type as string | null,
    website: p.website as string | null,
    notes: p.notes as string | null,
    updated_at: p.updated_at as string,
  }));

  const accounts: AccountOption[] = (accountsRes.data ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string | null,
  }));

  const contacts: ContactOption[] = (contactsRes.data ?? []).map((c) => ({
    id: c.id as string,
    full_name: c.full_name as string | null,
  }));

  return (
    <PropertiesClient
      properties={rows}
      accounts={accounts}
      contacts={contacts}
      orgId={orgId}
      userId={userId}
      userRole={meRes.data?.role ?? "rep"}
    />
  );
}
