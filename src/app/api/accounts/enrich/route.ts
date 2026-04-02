import { NextRequest, NextResponse } from "next/server";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import { createAdminClient } from "@/lib/supabase/admin";

export type EnrichResult = {
  id: string;
  source: "intel_properties" | "intel_prospects" | "google_places";
  company_name: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  property_type: string | null;
  sq_footage: number | null;
  owner_name: string | null;
  external_id: string | null;
  confidence_score: number;
};

export async function POST(req: NextRequest) {
  try {
    await requireServerOrgContext();

    const { account_name, account_state } = (await req.json()) as {
      account_name: string;
      account_state?: string;
    };

    if (!account_name) {
      return NextResponse.json({ error: "account_name required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const namePattern = `%${account_name}%`;

    // Search 1: intel_properties by owner/property name
    const { data: ipResults } = await admin
      .from("intel_properties")
      .select(
        "id,street_address,city,state,postal_code,property_name,property_type,sq_footage,owner_name,external_id,confidence_score"
      )
      .or(`owner_name.ilike.${namePattern},property_name.ilike.${namePattern}`)
      .eq("is_active", true)
      .limit(50);

    // Search 2: intel_prospects by company name
    const { data: prospectResults } = await admin
      .from("intel_prospects")
      .select(
        "id,company_name,address_line1,city,state,postal_code,account_type,confidence_score"
      )
      .ilike("company_name", namePattern)
      .neq("status", "converted")
      .limit(50);

    // Search 3: Google Places (if API key available)
    const placesResults: EnrichResult[] = [];
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (apiKey) {
      const query = account_state
        ? `${account_name} ${account_state}`
        : account_name;

      try {
        const resp = await fetch(
          `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`
        );
        if (resp.ok) {
          const data = (await resp.json()) as {
            results?: {
              name?: string;
              formatted_address?: string;
              place_id?: string;
              types?: string[];
              business_status?: string;
            }[];
          };

          for (const place of (data.results ?? []).slice(0, 20)) {
            if (!place.formatted_address) continue;

            // Parse address
            const parts = place.formatted_address.split(",").map((s) => s.trim());
            const street = parts[0] || null;
            const city = parts[1] || null;
            const stateZip = parts[2] || "";
            const stateMatch = stateZip.match(/^([A-Z]{2})\s*(\d{5})?/);

            placesResults.push({
              id: `gp_${place.place_id}`,
              source: "google_places",
              company_name: place.name ?? null,
              street_address: street,
              city,
              state: stateMatch?.[1] ?? null,
              postal_code: stateMatch?.[2] ?? null,
              property_type: null,
              sq_footage: null,
              owner_name: place.name ?? null,
              external_id: place.place_id ?? null,
              confidence_score: 30,
            });
          }
        }
      } catch {
        // Google Places failure is non-fatal
      }
    }

    // Combine and deduplicate by normalized address
    const seen = new Set<string>();
    const results: EnrichResult[] = [];

    // intel_properties first (highest quality)
    for (const r of ipResults ?? []) {
      const key = `${(r.street_address ?? "").toLowerCase()}|${(r.city ?? "").toLowerCase()}|${(r.state ?? "").toLowerCase()}`;
      if (key !== "||" && seen.has(key)) continue;
      if (key !== "||") seen.add(key);

      results.push({
        id: r.id as string,
        source: "intel_properties",
        company_name: r.property_name as string | null,
        street_address: r.street_address as string | null,
        city: r.city as string | null,
        state: r.state as string | null,
        postal_code: r.postal_code as string | null,
        property_type: r.property_type as string | null,
        sq_footage: r.sq_footage as number | null,
        owner_name: r.owner_name as string | null,
        external_id: r.external_id as string | null,
        confidence_score: r.confidence_score as number,
      });
    }

    // intel_prospects
    for (const r of prospectResults ?? []) {
      const key = `${(r.address_line1 ?? "").toLowerCase()}|${(r.city ?? "").toLowerCase()}|${(r.state ?? "").toLowerCase()}`;
      if (key !== "||" && seen.has(key)) continue;
      if (key !== "||") seen.add(key);

      results.push({
        id: r.id as string,
        source: "intel_prospects",
        company_name: r.company_name as string | null,
        street_address: r.address_line1 as string | null,
        city: r.city as string | null,
        state: r.state as string | null,
        postal_code: r.postal_code as string | null,
        property_type: null,
        sq_footage: null,
        owner_name: r.company_name as string | null,
        external_id: null,
        confidence_score: r.confidence_score as number,
      });
    }

    // Google Places
    for (const r of placesResults) {
      const key = `${(r.street_address ?? "").toLowerCase()}|${(r.city ?? "").toLowerCase()}|${(r.state ?? "").toLowerCase()}`;
      if (key !== "||" && seen.has(key)) continue;
      if (key !== "||") seen.add(key);
      results.push(r);
    }

    return NextResponse.json({ results, count: results.length });
  } catch (err) {
    console.error("[enrich]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
