import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type PushData = {
  company_name?: string;
  account_type?: string;
  city?: string;
  state?: string;
  website?: string;
  phone?: string;
  contact_name?: string;
  contact_title?: string;
  contact_email?: string;
  street_address?: string;
  property_type?: string;
  sq_footage?: number;
  owner_name?: string;
  intel_entity_id?: string;
  intel_property_id?: string;
  intel_prospect_id?: string;
  source_detail: string;
  confidence_score: number;
};

type PushRequest = {
  dilly_org_id: string;
  dilly_user_id: string;
  push_type: "account" | "property" | "entity";
  data: PushData;
};

export async function POST(req: NextRequest) {
  // 1. Validate secret
  const secret = req.headers.get("x-dilly-intel-secret");
  if (!secret || secret !== process.env.DILLY_INTEL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as PushRequest;
    const { dilly_org_id, dilly_user_id, data } = body;

    if (!dilly_org_id || !dilly_user_id || !data) {
      return NextResponse.json(
        { error: "dilly_org_id, dilly_user_id, and data are required" },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();
    let accountId: string | null = null;
    let propertyId: string | null = null;
    let prospectId: string | null = null;

    // 2. Create account if company_name exists
    if (data.company_name) {
      const { data: acct, error: acctErr } = await supabase
        .from("accounts")
        .insert({
          org_id: dilly_org_id,
          name: data.company_name,
          account_type: data.account_type ?? null,
          website: data.website ?? null,
          phone: data.phone ?? null,
          city: data.city ?? null,
          state: data.state ?? null,
          source: "dilly_intel",
          created_by: dilly_user_id,
        })
        .select("id")
        .single();

      if (acctErr) {
        return NextResponse.json(
          { error: `Account insert failed: ${acctErr.message}` },
          { status: 500 },
        );
      }
      accountId = acct.id as string;
    }

    // 3. Create contact if contact_name exists and account was created
    if (data.contact_name && accountId) {
      const parts = data.contact_name.trim().split(/\s+/);
      const firstName = parts[0] ?? "";
      const lastName = parts.slice(1).join(" ") || "";
      const fullName = data.contact_name.trim();

      await supabase.from("contacts").insert({
        org_id: dilly_org_id,
        account_id: accountId,
        full_name: fullName,
        first_name: firstName,
        last_name: lastName,
        title: data.contact_title ?? null,
        email: data.contact_email ?? null,
        phone: data.phone ?? null,
        created_by: dilly_user_id,
      });
    }

    // 4. Create property if street_address exists
    if (data.street_address) {
      const { data: prop, error: propErr } = await supabase
        .from("properties")
        .insert({
          org_id: dilly_org_id,
          address_line1: data.street_address,
          city: data.city ?? "Unknown",
          state: data.state ?? "XX",
          postal_code: "00000",
          sq_footage: data.sq_footage ?? null,
          primary_account_id: accountId,
          created_by: dilly_user_id,
        })
        .select("id")
        .single();

      if (!propErr && prop) {
        propertyId = prop.id as string;
      }
    }

    // 5. Create prospects record
    const { data: prospect, error: prospectErr } = await supabase
      .from("prospects")
      .insert({
        org_id: dilly_org_id,
        company_name: data.company_name ?? data.owner_name ?? "Unknown",
        address_line1: data.street_address ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        website: data.website ?? null,
        phone: data.phone ?? null,
        account_type: data.account_type ?? null,
        source: "dilly_intel",
        source_detail: data.source_detail ?? "intel_push",
        confidence_score: data.confidence_score ?? 80,
        contact_first_name: data.contact_name
          ? data.contact_name.trim().split(/\s+/)[0] ?? null
          : null,
        contact_last_name: data.contact_name
          ? data.contact_name.trim().split(/\s+/).slice(1).join(" ") || null
          : null,
        contact_title: data.contact_title ?? null,
      })
      .select("id")
      .single();

    if (prospectErr) {
      return NextResponse.json(
        { error: `Prospect insert failed: ${prospectErr.message}` },
        { status: 500 },
      );
    }
    prospectId = prospect.id as string;

    // 6. Create suggested_outreach record
    await supabase.from("suggested_outreach").insert({
      org_id: dilly_org_id,
      user_id: dilly_user_id,
      prospect_id: prospectId,
      status: "new",
      rank_score: data.confidence_score ?? 80,
      reason_codes: {
        source: "dilly_intel",
        intel_entity_id: data.intel_entity_id ?? null,
        intel_property_id: data.intel_property_id ?? null,
        intel_prospect_id: data.intel_prospect_id ?? null,
      },
    });

    // 7. Return result
    return NextResponse.json({
      success: true,
      account_id: accountId,
      property_id: propertyId,
      prospect_id: prospectId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
