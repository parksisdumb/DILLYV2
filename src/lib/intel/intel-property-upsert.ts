import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Upserts a record into intel_properties from prospect data.
 * Deduplicates on lower(street_address, city, state).
 * Returns the intel_property id if inserted/found, null on skip.
 */
export async function upsertIntelProperty(
  supabase: ReturnType<typeof createAdminClient>,
  data: {
    street_address: string | null;
    city: string | null;
    state: string | null;
    postal_code?: string | null;
    property_name?: string | null;
    property_type?: string | null;
    sq_footage?: number | null;
    owner_name?: string | null;
    owner_type?: string | null;
    entity_id?: string | null;
    source_detail: string;
    confidence_score?: number;
  }
): Promise<string | null> {
  // Skip if no address — can't dedup without it
  if (!data.street_address || !data.city || !data.state) return null;

  const { data: existing } = await supabase
    .from("intel_properties")
    .select("id")
    .ilike("street_address", data.street_address)
    .ilike("city", data.city)
    .ilike("state", data.state)
    .maybeSingle();

  if (existing) return existing.id as string;

  const { data: inserted, error } = await supabase
    .from("intel_properties")
    .insert({
      street_address: data.street_address,
      city: data.city,
      state: data.state,
      postal_code: data.postal_code ?? null,
      property_name: data.property_name ?? null,
      property_type: data.property_type ?? null,
      sq_footage: data.sq_footage ?? null,
      owner_name: data.owner_name ?? null,
      owner_type: data.owner_type ?? null,
      entity_id: data.entity_id ?? null,
      source_detail: data.source_detail,
      confidence_score: data.confidence_score ?? 25,
    })
    .select("id")
    .single();

  if (error) {
    // Unique constraint violation = already exists (race condition)
    if (error.code === "23505") return null;
    console.error("[intel-property-upsert]", error.message);
    return null;
  }

  return (inserted?.id as string) ?? null;
}
