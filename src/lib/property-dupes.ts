import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addressMatchTone,
  propertyDuplicateKey,
  streetNumber,
  type AddressMatchTone,
} from "@/lib/address";

/**
 * Shared "is this property already in Dilly?" lookup for every create surface.
 *
 * Deliberately advisory: it returns what it found and the key it found it for.
 * Callers WARN with it — they never refuse a create on the strength of it.
 * (A rep standing in a parking lot who cannot save the building she is looking
 * at will stop using the product. A duplicate is a cleanup task; a blocked rep
 * is lost data.)
 */

export type PropertyDupMatch = {
  id: string;
  name: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  /** Display label — name when present, else the street line. */
  label: string;
  /** Secondary line — full address. */
  sub: string;
};

export type PropertyDupResult = {
  /** The normalized key the matches were found for. "" when the address is too thin to check. */
  key: string;
  matches: PropertyDupMatch[];
};

export const EMPTY_DUP_RESULT: PropertyDupResult = { key: "", matches: [] };

export async function findPropertyDuplicates(
  supabase: SupabaseClient,
  input: {
    addressLine1: string | null | undefined;
    city?: string | null;
    /** Omit a record from the results (e.g. the row being edited). */
    excludeId?: string | null;
  },
): Promise<PropertyDupResult> {
  const key = propertyDuplicateKey(input.addressLine1, input.city);
  if (!key) return EMPTY_DUP_RESULT;

  let query = supabase
    .from("properties")
    .select("id,name,address_line1,address_line2,city,state")
    .is("deleted_at", null)
    .limit(200);

  const city = (input.city ?? "").trim();
  if (city) query = query.ilike("city", city);
  // Narrow by street number too, so a blank/typo'd city still gives a bounded scan.
  const num = streetNumber(input.addressLine1);
  if (num) query = query.ilike("address_line1", `%${num}%`);

  const { data, error } = await query;
  // A failed lookup must never block the create — fall through to "no matches".
  if (error || !data) return { key, matches: [] };

  const matches = (data as unknown as Record<string, unknown>[])
    .filter((p) => p.id !== input.excludeId)
    .filter(
      (p) =>
        propertyDuplicateKey(p.address_line1 as string, p.city as string | null) === key,
    )
    .map((p) => {
      const addressLine1 = (p.address_line1 as string) ?? "";
      const name = (p.name as string | null) ?? null;
      return {
        id: p.id as string,
        name,
        addressLine1,
        addressLine2: (p.address_line2 as string | null) ?? null,
        city: (p.city as string | null) ?? null,
        state: (p.state as string | null) ?? null,
        label: name || addressLine1 || "Unnamed property",
        sub: [addressLine1, p.address_line2, p.city, p.state].filter(Boolean).join(", "),
      } satisfies PropertyDupMatch;
    });

  return { key, matches };
}

/**
 * Grade each match against what the rep actually typed. Recomputed on every
 * keystroke, so adding a suite downgrades the warning live instead of the rep
 * having to guess why the app still calls it a duplicate.
 */
export function tonedMatches(
  matches: PropertyDupMatch[],
  typed: { addressLine1: string; addressLine2?: string | null },
): (PropertyDupMatch & { tone: AddressMatchTone })[] {
  return matches.map((m) => ({
    ...m,
    tone: addressMatchTone(
      { addressLine1: typed.addressLine1, addressLine2: typed.addressLine2 ?? null },
      { addressLine1: m.addressLine1, addressLine2: m.addressLine2 },
    ),
  }));
}

/** Overall tone for a set: any exact-suite match makes it a real duplicate. */
export function overallTone(
  matches: { tone: AddressMatchTone }[],
): AddressMatchTone {
  return matches.some((m) => m.tone === "duplicate") ? "duplicate" : "similar";
}
