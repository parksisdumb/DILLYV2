import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Advisory duplicate lookups for accounts and contacts.
 *
 * Same contract as the property lookup (src/lib/property-dupes.ts): these WARN,
 * they never block. A failed lookup returns no matches so a flaky query can never
 * stop a rep from saving.
 */

// LEGAL-FORM noise only — the stuff that makes one company look like two
// ("Tarantino Properties" vs "Tarantino Properties, Inc."). Descriptive words
// (properties, management, group, holdings, partners, services) are deliberately NOT
// in here: they are part of the company's identity, and stripping them collapsed
// "Tarantino Properties" and "Tarantino Management" onto the same key — manufacturing
// exactly the false positives this work exists to remove.
const COMPANY_SUFFIXES = new Set([
  "inc", "inc's", "incorporated", "llc", "llp", "lp", "plc", "ltd", "limited",
  "corp", "corporation", "co", "company",
]);

function tokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .toLowerCase()
    .normalize("NFKD")
    // Drop periods BEFORE the punctuation pass so "L.L.C." becomes one "llc" token
    // rather than three single letters the suffix list can never match.
    .replace(/\./g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/**
 * Canonical company name for comparison. Drops leading "the" and trailing legal /
 * generic suffixes, but never returns empty — if every token is a suffix (e.g. "The
 * Management Group") we keep the full token list rather than collapsing unrelated
 * companies onto one blank key.
 */
export function normalizeCompanyName(raw: string | null | undefined): string {
  const t = tokens(raw);
  if (t.length === 0) return "";
  const out = [...t];
  if (out.length > 1 && out[0] === "the") out.shift();
  while (out.length > 1 && COMPANY_SUFFIXES.has(out[out.length - 1])) out.pop();
  return (out.length > 0 ? out : t).join(" ");
}

/** Canonical person name for comparison — first + last, punctuation and case folded. */
export function normalizePersonName(raw: string | null | undefined): string {
  return tokens(raw).join(" ");
}

export type EntityDupMatch = {
  id: string;
  label: string;
  sub: string;
  /** Why it matched, so the copy can say so. */
  reason: "name" | "email";
};

export type EntityDupResult = { key: string; matches: EntityDupMatch[] };
export const EMPTY_ENTITY_DUP: EntityDupResult = { key: "", matches: [] };

const ACCOUNT_TYPE_HINT = (t: string | null) => (t ? t.replace(/_/g, " ") : "");

/** Accounts in the org whose normalized name equals the typed one. */
export async function findAccountDuplicates(
  supabase: SupabaseClient,
  name: string,
  opts?: { excludeId?: string | null },
): Promise<EntityDupResult> {
  const key = normalizeCompanyName(name);
  if (!key) return EMPTY_ENTITY_DUP;

  // Narrow on the most distinctive token so the scan stays bounded, then compare
  // properly in JS (ilike alone can't do suffix-stripping).
  const anchor = key.split(" ").reduce((a, b) => (b.length > a.length ? b : a), "");
  let query = supabase
    .from("accounts")
    .select("id,name,account_type")
    .is("deleted_at", null)
    .limit(200);
  if (anchor.length >= 3) query = query.ilike("name", `%${anchor}%`);

  const { data, error } = await query;
  if (error || !data) return { key, matches: [] };

  const matches = (data as unknown as Record<string, unknown>[])
    .filter((a) => a.id !== opts?.excludeId)
    .filter((a) => normalizeCompanyName(a.name as string | null) === key)
    .map((a) => ({
      id: a.id as string,
      label: (a.name as string | null) || "Unnamed account",
      sub: ACCOUNT_TYPE_HINT(a.account_type as string | null) || "account",
      reason: "name" as const,
    }));
  return { key, matches };
}

/**
 * Contacts that look like the person being typed: the same normalized full name
 * anywhere in the org, or the same email. Name matches inside the SAME account are
 * the strong signal; a same-name person at a different account is still worth
 * showing, labelled with where they work.
 */
export async function findContactDuplicates(
  supabase: SupabaseClient,
  input: { fullName: string; email?: string | null; excludeId?: string | null },
): Promise<EntityDupResult> {
  const key = normalizePersonName(input.fullName);
  const email = (input.email ?? "").trim().toLowerCase();
  if (!key && !email) return EMPTY_ENTITY_DUP;

  const last = key.split(" ").slice(-1)[0] ?? "";
  const ors: string[] = [];
  if (last.length >= 2) ors.push(`full_name.ilike.%${last}%`);
  if (email) ors.push(`email.ilike.${email}`);
  if (ors.length === 0) return { key, matches: [] };

  const { data, error } = await supabase
    .from("contacts")
    .select("id,full_name,title,email,account_id")
    .is("deleted_at", null)
    .or(ors.join(","))
    .limit(200);
  if (error || !data) return { key, matches: [] };

  const rows = (data as unknown as Record<string, unknown>[]).filter(
    (c) => c.id !== input.excludeId,
  );
  const accountIds = [...new Set(rows.map((c) => c.account_id as string).filter(Boolean))];
  const names = new Map<string, string>();
  if (accountIds.length > 0) {
    const { data: accts } = await supabase
      .from("accounts")
      .select("id,name")
      .in("id", accountIds);
    for (const a of accts ?? []) names.set(a.id as string, (a.name as string | null) ?? "");
  }

  const matches: EntityDupMatch[] = [];
  for (const c of rows) {
    const sameEmail = Boolean(email) && String(c.email ?? "").trim().toLowerCase() === email;
    const sameName = Boolean(key) && normalizePersonName(c.full_name as string | null) === key;
    if (!sameEmail && !sameName) continue;
    matches.push({
      id: c.id as string,
      label: (c.full_name as string | null) || "Unnamed contact",
      sub: [c.title as string | null, names.get(c.account_id as string) || null, c.email as string | null]
        .filter(Boolean)
        .join(" · "),
      reason: sameEmail ? "email" : "name",
    });
  }
  // Email matches are the stronger signal — show them first.
  matches.sort((a, b) => (a.reason === b.reason ? 0 : a.reason === "email" ? -1 : 1));
  return { key, matches };
}
