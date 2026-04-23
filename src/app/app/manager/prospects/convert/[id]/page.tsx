import { redirect } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import ConvertFormClient from "./convert-form-client";

export type ProspectForConvert = {
  id: string;
  company_name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  account_type: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_title: string | null;
  notes: string | null;
};

type TouchpointTypeOption = { id: string; key: string; label: string };
type OutcomeOption = { id: string; key: string; label: string };

export default async function ConvertProspectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, userId } = await requireServerOrgContext();

  // Role gate
  const { data: orgUser } = await supabase
    .from("org_users")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (!orgUser || !["manager", "admin", "rep"].includes(orgUser.role)) {
    redirect("/app");
  }

  // Fetch prospect + lookup data in parallel
  const [prospectRes, typesRes, outcomesRes] = await Promise.all([
    supabase.from("prospects").select("id,company_name,email,phone,website,address_line1,city,state,postal_code,account_type,contact_first_name,contact_last_name,contact_title,notes").eq("id", id).maybeSingle(),
    supabase.from("touchpoint_types").select("id,key,label").eq("is_outreach", true).order("sort_order"),
    supabase.from("touchpoint_outcomes").select("id,key,label").order("sort_order"),
  ]);

  if (!prospectRes.data) redirect("/app/manager/prospects");

  const prospect: ProspectForConvert = {
    id: prospectRes.data.id as string,
    company_name: prospectRes.data.company_name as string,
    email: prospectRes.data.email as string | null,
    phone: prospectRes.data.phone as string | null,
    website: prospectRes.data.website as string | null,
    address_line1: prospectRes.data.address_line1 as string | null,
    city: prospectRes.data.city as string | null,
    state: prospectRes.data.state as string | null,
    postal_code: prospectRes.data.postal_code as string | null,
    account_type: prospectRes.data.account_type as string | null,
    contact_first_name: prospectRes.data.contact_first_name as string | null,
    contact_last_name: prospectRes.data.contact_last_name as string | null,
    contact_title: prospectRes.data.contact_title as string | null,
    notes: prospectRes.data.notes as string | null,
  };

  const touchpointTypes: TouchpointTypeOption[] = (typesRes.data ?? []).map((t) => ({
    id: t.id as string,
    key: t.key as string,
    label: t.label as string,
  }));

  const outcomes: OutcomeOption[] = (outcomesRes.data ?? []).map((o) => ({
    id: o.id as string,
    key: o.key as string,
    label: o.label as string,
  }));

  // Server action
  async function convertAction(formData: FormData) {
    "use server";
    const { supabase: sb } = await requireServerOrgContext();

    const prospectId = String(formData.get("prospect_id") ?? "");
    const accountName = String(formData.get("account_name") ?? "").trim();
    if (!accountName) {
      redirect(`/app/manager/prospects/convert/${prospectId}?error=Account+name+is+required`);
    }

    const createContact = formData.get("create_contact") === "on";
    const createProperty = formData.get("create_property") === "on";
    const logTouchpoint = formData.get("log_touchpoint") === "on";

    const propertyName = String(formData.get("property_name") ?? "").trim();
    if (createProperty && !propertyName) {
      redirect(`/app/manager/prospects/convert/${prospectId}?error=Property+name+is+required`);
    }

    const { data, error } = await sb.rpc("rpc_convert_prospect", {
      p_prospect_id: prospectId,
      p_account_name: accountName,
      p_account_type: String(formData.get("account_type") ?? "") || null,
      p_account_website: String(formData.get("account_website") ?? "").trim() || null,
      p_account_phone: String(formData.get("account_phone") ?? "").trim() || null,
      p_account_notes: String(formData.get("account_notes") ?? "").trim() || null,
      p_create_contact: createContact,
      p_contact_full_name: String(formData.get("contact_full_name") ?? "").trim() || null,
      p_contact_first_name: String(formData.get("contact_first_name") ?? "").trim() || null,
      p_contact_last_name: String(formData.get("contact_last_name") ?? "").trim() || null,
      p_contact_title: String(formData.get("contact_title") ?? "").trim() || null,
      p_contact_email: String(formData.get("contact_email") ?? "").trim() || null,
      p_contact_phone: String(formData.get("contact_phone") ?? "").trim() || null,
      p_create_property: createProperty,
      p_property_address: String(formData.get("property_address") ?? "").trim() || null,
      p_property_city: String(formData.get("property_city") ?? "").trim() || null,
      p_property_state: String(formData.get("property_state") ?? "").trim() || null,
      p_property_postal_code: String(formData.get("property_postal_code") ?? "").trim() || null,
      p_log_touchpoint: logTouchpoint,
      p_touchpoint_type_id: String(formData.get("touchpoint_type_id") ?? "") || null,
      p_touchpoint_outcome_id: String(formData.get("touchpoint_outcome_id") ?? "") || null,
      p_touchpoint_notes: String(formData.get("touchpoint_notes") ?? "").trim() || null,
    });

    if (error) {
      redirect(`/app/manager/prospects/convert/${prospectId}?error=${encodeURIComponent(error.message)}`);
    }

    const result = data as { account_id: string; property_id: string | null } | null;

    if (result?.property_id && propertyName) {
      await sb.from("properties").update({ name: propertyName }).eq("id", result.property_id);
    }

    if (result?.account_id) {
      redirect(`/app/accounts/${result.account_id}`);
    }
    redirect("/app/manager/prospects");
  }

  return (
    <ConvertFormClient
      prospect={prospect}
      touchpointTypes={touchpointTypes}
      outcomes={outcomes}
      convertAction={convertAction}
    />
  );
}
