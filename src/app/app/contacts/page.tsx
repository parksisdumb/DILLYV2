import { requireServerOrgContext } from "@/lib/supabase/server-org";
import ContactsClient from "@/app/app/contacts/contacts-client";

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
};

export type AccountOption = { id: string; name: string | null };
export type PropertyOption = { id: string; address_line1: string; city: string | null; state: string | null; primary_account_id: string | null };

export default async function ContactsPage() {
  const { supabase, userId } = await requireServerOrgContext();

  const [contactsRes, accountsRes, tpRes, meRes, propsRes] = await Promise.all([
    supabase
      .from("contacts")
      .select("id,full_name,title,phone,email,decision_role,account_id,updated_at")
      .is("deleted_at", null)
      .order("full_name")
      .limit(500),
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
    supabase
      .from("properties")
      .select("id,address_line1,city,state,primary_account_id")
      .is("deleted_at", null)
      .order("address_line1")
      .limit(500),
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
  }));

  const accounts: AccountOption[] = (accountsRes.data ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string | null,
  }));

  const properties: PropertyOption[] = (propsRes.data ?? []).map((p) => ({
    id: p.id as string,
    address_line1: p.address_line1 as string,
    city: p.city as string | null,
    state: p.state as string | null,
    primary_account_id: p.primary_account_id as string | null,
  }));

  return (
    <ContactsClient
      contacts={rows}
      accounts={accounts}
      properties={properties}
      userId={userId}
      userRole={meRes.data?.role ?? "rep"}
    />
  );
}
