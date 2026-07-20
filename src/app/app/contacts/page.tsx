import { requireServerOrgContext } from "@/lib/supabase/server-org";
import ContactsClient from "@/app/app/contacts/contacts-client";
import { contactCompleteness, type CompletenessResult } from "@/lib/completeness";

type ContactRow = {
  id: string;
  full_name: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  decision_role: string | null;
  account_id: string;
  account_name: string | null;
  last_touch_at: string | null;
  updated_at: string;
  created_by: string | null;
  completeness: CompletenessResult;
};

export type AccountOption = { id: string; name: string | null };
export type PropertyOption = { id: string; address_line1: string; city: string | null; state: string | null; primary_account_id: string | null };

export default async function ContactsPage() {
  const { supabase, userId } = await requireServerOrgContext();

  const [contactsRes, accountsRes, tpRes, meRes, orgUsersRes, pcRes] = await Promise.all([
    supabase
      .from("contacts")
      .select("id,full_name,first_name,last_name,title,phone,email,decision_role,account_id,updated_at,created_by")
      .is("deleted_at", null)
      .order("full_name")
      .limit(200),
    supabase
      .from("accounts")
      .select("id,name")
      .is("deleted_at", null)
      .order("name")
      .limit(500),
    supabase
      .from("touchpoints")
      .select("contact_id,happened_at")
      .not("contact_id", "is", null),
    supabase.from("org_users").select("role").eq("user_id", userId).maybeSingle(),
    supabase.from("org_users").select("user_id,full_name,email").order("full_name"),
    supabase.from("property_contacts").select("contact_id").eq("active", true),
  ]);

  if (contactsRes.error) throw new Error(contactsRes.error.message);

  // Build last_touch_at per contact
  const lastTouchByContact = new Map<string, string>();
  for (const tp of tpRes.data ?? []) {
    const cid = tp.contact_id as string;
    const t = tp.happened_at as string;
    const existing = lastTouchByContact.get(cid);
    if (!existing || t > existing) lastTouchByContact.set(cid, t);
  }

  // Build accounts map
  const accountsById = new Map<string, string | null>();
  for (const a of accountsRes.data ?? []) {
    accountsById.set(a.id as string, a.name as string | null);
  }

  const linkedContactIds = new Set((pcRes.data ?? []).map((p) => p.contact_id as string));

  const rows: ContactRow[] = (contactsRes.data ?? []).map((c) => ({
    id: c.id as string,
    full_name: c.full_name as string | null,
    title: c.title as string | null,
    phone: c.phone as string | null,
    email: c.email as string | null,
    decision_role: c.decision_role as string | null,
    account_id: c.account_id as string,
    account_name: accountsById.get(c.account_id as string) ?? null,
    last_touch_at: lastTouchByContact.get(c.id as string) ?? null,
    updated_at: c.updated_at as string,
    created_by: c.created_by as string | null,
    completeness: contactCompleteness({
      first_name: (c as { first_name: string | null }).first_name,
      last_name: (c as { last_name: string | null }).last_name,
      title: c.title as string | null,
      phone: c.phone as string | null,
      email: c.email as string | null,
      hasProperty: linkedContactIds.has(c.id as string),
    }),
  }));

  const accounts: AccountOption[] = (accountsRes.data ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string | null,
  }));

  const reps = (orgUsersRes.data ?? []).map((u) => ({
    userId: u.user_id as string,
    name: (u.full_name as string | null)?.trim() || (u.email as string | null)?.split("@")[0] || (u.user_id as string).slice(0, 8),
  }));

  return (
    <ContactsClient
      contacts={rows}
      reps={reps}
      accounts={accounts}
      userId={userId}
      userRole={meRes.data?.role ?? "rep"}
    />
  );
}
