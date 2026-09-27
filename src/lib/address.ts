/**
 * Address normalization for duplicate detection.
 *
 * Commercial property data arrives from many sources (manual entry, CSV import,
 * intel/discover feeds, prospect conversion) with inconsistent formatting, so the
 * same building shows up as "300 Bardin Greene Dr" and "300 Bardin Greene Drive",
 * or "Bardin Greene Apartments" vs "Bardin Greene". We can't rely on exact string
 * equality. This module produces a canonical form of address_line1 + city so two
 * spellings of the same location collapse to one key.
 *
 * Pure + dependency-free so it runs identically in the browser (create-time dedup,
 * Data Health collision list) and could be mirrored in SQL if ever needed.
 */

// USPS-style street-suffix standardization → canonical long form.
const STREET_SUFFIXES: Record<string, string> = {
  st: "street",
  str: "street",
  street: "street",
  ave: "avenue",
  av: "avenue",
  avenue: "avenue",
  blvd: "boulevard",
  boul: "boulevard",
  boulevard: "boulevard",
  dr: "drive",
  drv: "drive",
  drive: "drive",
  rd: "road",
  road: "road",
  ln: "lane",
  lane: "lane",
  ct: "court",
  crt: "court",
  court: "court",
  cir: "circle",
  circle: "circle",
  pl: "place",
  place: "place",
  pkwy: "parkway",
  pky: "parkway",
  parkway: "parkway",
  hwy: "highway",
  highway: "highway",
  ter: "terrace",
  terr: "terrace",
  terrace: "terrace",
  trl: "trail",
  trail: "trail",
  way: "way",
  sq: "square",
  square: "square",
  loop: "loop",
  pt: "point",
  point: "point",
  cres: "crescent",
  crescent: "crescent",
  expy: "expressway",
  expressway: "expressway",
};

// Directionals → canonical single/double letter (also expands full words).
const DIRECTIONALS: Record<string, string> = {
  n: "n",
  north: "n",
  s: "s",
  south: "s",
  e: "e",
  east: "e",
  w: "w",
  west: "w",
  ne: "ne",
  northeast: "ne",
  nw: "nw",
  northwest: "nw",
  se: "se",
  southeast: "se",
  sw: "sw",
  southwest: "sw",
};

// Secondary-unit designators dropped entirely (suite/unit/floor rarely identify a building).
const UNIT_TOKENS = new Set([
  "suite",
  "ste",
  "unit",
  "apt",
  "apartment",
  "bldg",
  "building",
  "fl",
  "floor",
  "rm",
  "room",
  "#",
]);

function baseTokens(input: string): string[] {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ") // strip punctuation (periods, commas, #, hyphens)
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/**
 * Canonicalize a street address line for comparison.
 * Returns "" for empty/whitespace input.
 */
export function normalizeAddressLine1(raw: string | null | undefined): string {
  if (!raw) return "";
  // Drop a bare "#400" BEFORE tokenizing. baseTokens strips punctuation, so by the
  // time we see tokens the "#" is gone and "400" looks like part of the street —
  // which made "300 Main St #400" and "300 Main St Suite 400" produce DIFFERENT
  // keys and silently skip the duplicate check between them.
  const tokens = baseTokens(raw.replace(/#\s*[\w-]+/g, " "));
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    // Drop a unit designator plus its following value (e.g. "suite 100", "ste b").
    if (UNIT_TOKENS.has(tok)) {
      i += 1; // skip the unit value that typically follows
      continue;
    }
    if (STREET_SUFFIXES[tok]) {
      out.push(STREET_SUFFIXES[tok]);
      continue;
    }
    if (DIRECTIONALS[tok]) {
      out.push(DIRECTIONALS[tok]);
      continue;
    }
    out.push(tok);
  }
  return out.join(" ").trim();
}

/**
 * Canonicalize a city name for comparison.
 */
export function normalizeCity(raw: string | null | undefined): string {
  if (!raw) return "";
  return baseTokens(raw).join(" ");
}

/**
 * Composite key for grouping likely-duplicate properties within an org.
 * Empty when the address is blank (so unaddressed rows never collide).
 */
export function propertyDuplicateKey(
  addressLine1: string | null | undefined,
  city: string | null | undefined,
): string {
  const addr = normalizeAddressLine1(addressLine1);
  if (!addr) return "";
  const c = normalizeCity(city);
  return `${addr}|${c}`;
}

// ---------------------------------------------------------------------------
// Suite / unit awareness for duplicate *tone*.
//
// `normalizeAddressLine1` deliberately DROPS suite/unit/building tokens so that
// "300 Bardin Greene Dr Ste 100" and "300 Bardin Greene Dr" collapse to one key
// — that is what we want for grouping. But it also means a rep entering a second,
// genuinely different building or space on the same street gets told "duplicate".
// Telling her "this address already exists" when she typed a different suite is a
// false positive, and the thing that makes her distrust (or fight) the warning.
//
// So we keep the key coarse and grade the WARNING instead: same street + same
// suite (or neither has one) is a real duplicate; same street + different suite
// is merely similar.
// ---------------------------------------------------------------------------

// Designators we trust to introduce a unit value. Intentionally excludes the
// ambiguous short forms "fl" and "rm" — "…, Orlando FL 32801" crammed into
// address_line1 would otherwise read as "floor 32801". Missing a unit only ever
// costs us a stronger warning, which is the safe direction.
const UNIT_DESIGNATOR_RE =
  /\b(suite|ste|unit|apt|apartment|bldg|building|floor|room)\b\.?\s*#?\s*([a-z0-9-]+)/i;
const BARE_UNIT_RE = /#\s*([a-z0-9-]+)/;

/**
 * Pull the suite/unit/building value out of one or more address lines.
 * Reps put it in either line, so pass both; the first line that has one wins.
 * Returns "" when there is no unit designator.
 */
export function extractUnitDesignator(
  ...parts: (string | null | undefined)[]
): string {
  for (const raw of parts) {
    if (!raw) continue;
    const m = UNIT_DESIGNATOR_RE.exec(raw) ?? BARE_UNIT_RE.exec(raw);
    if (!m) continue;
    const value = (m[2] ?? m[1] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (value) return value;
  }
  return "";
}

/** How loudly to warn about a normalized-address match. */
export type AddressMatchTone = "duplicate" | "similar";

export function addressMatchTone(
  typed: { addressLine1?: string | null; addressLine2?: string | null },
  existing: { addressLine1?: string | null; addressLine2?: string | null },
): AddressMatchTone {
  const a = extractUnitDesignator(typed.addressLine1, typed.addressLine2);
  const b = extractUnitDesignator(existing.addressLine1, existing.addressLine2);
  return a === b ? "duplicate" : "similar";
}

/** First purely-numeric token of a normalized address — used to narrow the dupe query. */
export function streetNumber(addressLine1: string | null | undefined): string {
  const tokens = normalizeAddressLine1(addressLine1).split(" ");
  return tokens.find((t) => /^\d+$/.test(t)) ?? "";
}
