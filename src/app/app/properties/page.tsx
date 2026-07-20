import { requireServerOrgContext } from "@/lib/supabase/server-org";
import PropertiesClient from "@/app/app/properties/properties-client";
import { propertyCompleteness, type CompletenessResult } from "@/lib/completeness";

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
  created_by: string | null;
  completeness: CompletenessResult;
  assignments: { userId: string; name: string }[];
};

export type AccountOption = { id: string; name: string | null };
export type ContactOption = { id: string; full_name: string | null };

export default async function PropertiesPage() {
  const { supabase, userId, orgId } = await requireServerOrgContext();

  const [propsRes, accountsRes, contactsRes, oppsRes, meRes, orgUsersRes, pcRes, paRes] = await Promise.all([
    supabase
      .from("properties")
      .select(
        "id,name,address_line1,address_line2,city,state,postal_code,primary_account_id,primary_contact_id,roof_type,roof_age_years,sq_footage,building_type,website,notes,updated_at,created_by",
      )
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase.from("accounts").select("id,name").is("deleted_at", null).order("name").limit(500),
    supabase.from("contacts").select("id,full_name").is("deleted_at", null).limit(500),
    supabase.from("opportunities").select("property_id").eq("status", "open"),
    supabase.from("org_users").select("role").eq("user_id", userId).maybeSingle(),
    supabase.from("org_users").select("user_id,full_name,email").order("full_name"),
    supabase.from("property_contacts").select("property_id").eq("active", true),
    supabase.from("property_assignments").select("property_id,user_id"),
  ]);

  if (propsRes.error) throw new Error(propsRes.error.message);

  const propIdsWithContact = new Set((pcRes.data ?? []).map((p) => p.property_id as string));

  // Dispatch assignments: property_id -> assigned reps (batch-mapped, no N+1).
  const repNameById = new Map<string, string>();
  for (const u of orgUsersRes.data ?? []) {
    repNameById.set(
      u.user_id as string,
      (u.full_name as string | null)?.trim() || (u.email as string | null)?.split("@")[0] || (u.user_id as string).slice(0, 8),
    );
  }
  const assignmentsByProperty = new Map<string, { userId: string; name: string }[]>();
  for (const a of (paRes.data ?? []) as { property_id: string; user_id: string }[]) {
    if (!assignmentsByProperty.has(a.property_id)) assignmentsByProperty.set(a.property_id, []);
    assignmentsByProperty.get(a.property_id)!.push({ userId: a.user_id, name: repNameById.get(a.user_id) ?? a.user_id.slice(0, 8) });
  }

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
    created_by: p.created_by as string | null,
    completeness: propertyCompleteness({
      roof_type: p.roof_type as string | null,
      sq_footage: p.sq_footage as number | null,
      roof_age_years: p.roof_age_years as number | null,
      primary_account_id: p.primary_account_id as string | null,
      hasContact: propIdsWithContact.has(p.id as string),
    }),
    assignments: assignmentsByProperty.get(p.id as string) ?? [],
  }));

  const accounts: AccountOption[] = (accountsRes.data ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string | null,
  }));

  const contacts: ContactOption[] = (contactsRes.data ?? []).map((c) => ({
    id: c.id as string,
    full_name: c.full_name as string | null,
  }));

  const reps = (orgUsersRes.data ?? []).map((u) => ({
    userId: u.user_id as string,
    name: (u.full_name as string | null)?.trim() || (u.email as string | null)?.split("@")[0] || (u.user_id as string).slice(0, 8),
  }));

  return (
    <PropertiesClient
      properties={rows}
      reps={reps}
      accounts={accounts}
      contacts={contacts}
      orgId={orgId}
      userId={userId}
      userRole={meRes.data?.role ?? "rep"}
    />
  );
}
