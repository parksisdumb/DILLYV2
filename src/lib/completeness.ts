// File Completeness calculators — pure functions, one per record type.
//
// Each returns { score: 0-100, missing: [{key,label}] }. They take a flat input
// where the record's own scalar fields are passed raw and relational/time signals
// (has a contact, recent touch, etc.) are pre-resolved to booleans by the caller —
// so the functions stay pure and can run identically on the server (batch) or in
// the browser (per-record chip). No DB access, no surprises.

export type MissingField = { key: string; label: string };
export type CompletenessResult = { score: number; missing: MissingField[] };

type FieldSpec<T> = { key: string; label: string; present: (r: T) => boolean };

const str = (v: string | null | undefined): boolean => typeof v === "string" && v.trim().length > 0;
const id = (v: string | null | undefined): boolean => typeof v === "string" && v.length > 0;
const posNum = (v: number | null | undefined): boolean => typeof v === "number" && v > 0;
const nonNegNum = (v: number | null | undefined): boolean => typeof v === "number" && v >= 0;

export const DAY_MS = 86_400_000;

/** Is an ISO timestamp within `days` of `now`? Exposed so callers can pre-resolve recency. */
export function withinDays(iso: string | null | undefined, days: number, now: number = Date.now()): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && now - t <= days * DAY_MS;
}

function evaluate<T>(record: T, specs: FieldSpec<T>[]): CompletenessResult {
  const missing = specs.filter((s) => !s.present(record)).map((s) => ({ key: s.key, label: s.label }));
  const score = specs.length === 0 ? 100 : Math.round(((specs.length - missing.length) / specs.length) * 100);
  return { score, missing };
}

// ── Account ─────────────────────────────────────────────────────────────────

export type AccountCompletenessInput = {
  account_type: string | null;
  website: string | null;
  hasContact: boolean;
  hasProperty: boolean;
  recentTouch: boolean; // a touchpoint within 90 days — caller resolves via withinDays(lastTouchAt, 90)
  onboarding_status?: string | null;
  hasWonOpportunity?: boolean; // a won opp on this account
};

export const ACCOUNT_FIELDS: FieldSpec<AccountCompletenessInput>[] = [
  { key: "account_type", label: "account type", present: (r) => str(r.account_type) },
  { key: "website", label: "website", present: (r) => str(r.website) },
  { key: "contact", label: "a contact", present: (r) => r.hasContact },
  { key: "property", label: "a property", present: (r) => r.hasProperty },
  { key: "recent_touch", label: "recent activity (90d)", present: (r) => r.recentTouch },
];

// Only applied when the account has a won opportunity: a won deal on an account
// that hasn't reached 'compliant' vendor onboarding is a real gap — the vendor
// isn't cleared to actually do the work.
const ACCOUNT_ONBOARDING_FIELD: FieldSpec<AccountCompletenessInput> = {
  key: "onboarding",
  label: "onboarding incomplete",
  present: (r) => r.onboarding_status === "compliant",
};

export const accountCompleteness = (r: AccountCompletenessInput): CompletenessResult => {
  const specs = r.hasWonOpportunity ? [...ACCOUNT_FIELDS, ACCOUNT_ONBOARDING_FIELD] : ACCOUNT_FIELDS;
  return evaluate(r, specs);
};

// ── Contact ─────────────────────────────────────────────────────────────────

export type ContactCompletenessInput = {
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  hasProperty: boolean; // linked to >= 1 property via property_contacts
};

export const CONTACT_FIELDS: FieldSpec<ContactCompletenessInput>[] = [
  { key: "name", label: "first & last name", present: (r) => str(r.first_name) && str(r.last_name) },
  { key: "title", label: "title", present: (r) => str(r.title) },
  { key: "phone", label: "phone", present: (r) => str(r.phone) },
  { key: "email", label: "email", present: (r) => str(r.email) },
  { key: "property", label: "a linked property", present: (r) => r.hasProperty },
];

export const contactCompleteness = (r: ContactCompletenessInput): CompletenessResult => evaluate(r, CONTACT_FIELDS);

// ── Property ────────────────────────────────────────────────────────────────

export type PropertyCompletenessInput = {
  roof_type: string | null;
  sq_footage: number | null;
  roof_age_years: number | null;
  primary_account_id: string | null;
  hasContact: boolean; // >= 1 linked contact via property_contacts
};

export const PROPERTY_FIELDS: FieldSpec<PropertyCompletenessInput>[] = [
  { key: "roof_type", label: "roof type", present: (r) => str(r.roof_type) },
  { key: "sq_footage", label: "square footage", present: (r) => posNum(r.sq_footage) },
  { key: "roof_age_years", label: "roof age", present: (r) => nonNegNum(r.roof_age_years) },
  { key: "primary_account_id", label: "owner account", present: (r) => id(r.primary_account_id) },
  { key: "contact", label: "a linked contact", present: (r) => r.hasContact },
];

export const propertyCompleteness = (r: PropertyCompletenessInput): CompletenessResult => evaluate(r, PROPERTY_FIELDS);

// ── Opportunity ─────────────────────────────────────────────────────────────

export type OpportunityCompletenessInput = {
  stage_id: string | null; // NOT NULL in schema — effectively always present
  scope_type_id: string | null; // NOT NULL in schema — effectively always present
  estimated_value: number | null;
  account_id: string | null;
  hasTouchpoint: boolean; // touchpoint on this opp or its property
};

export const OPPORTUNITY_FIELDS: FieldSpec<OpportunityCompletenessInput>[] = [
  { key: "stage_id", label: "stage", present: (r) => id(r.stage_id) },
  { key: "scope_type_id", label: "scope", present: (r) => id(r.scope_type_id) },
  { key: "estimated_value", label: "estimated value", present: (r) => posNum(r.estimated_value) },
  { key: "account_id", label: "account", present: (r) => id(r.account_id) },
  { key: "touchpoint", label: "a touchpoint", present: (r) => r.hasTouchpoint },
];

export const opportunityCompleteness = (r: OpportunityCompletenessInput): CompletenessResult =>
  evaluate(r, OPPORTUNITY_FIELDS);

// ── Shared helpers for aggregate (org-wide) views ────────────────────────────

export type RecordType = "account" | "contact" | "property" | "opportunity";

/** Average completeness score across a set of results (0 when empty). */
export function averageScore(results: CompletenessResult[]): number {
  if (results.length === 0) return 0;
  return Math.round(results.reduce((s, r) => s + r.score, 0) / results.length);
}

/** List-page completeness filter: "" = all, "incomplete" = score < 100, "complete" = 100. */
export function matchesCompleteness(score: number, filter: string): boolean {
  if (filter === "incomplete") return score < 100;
  if (filter === "complete") return score >= 100;
  return true;
}

/** Tailwind text color for a completeness score (green/amber/red). */
export function scoreTone(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 50) return "text-amber-600";
  return "text-red-600";
}

/** Tally how often each missing field appears, sorted most-common first. */
export function topMissing(results: CompletenessResult[]): { key: string; label: string; count: number }[] {
  const tally = new Map<string, { label: string; count: number }>();
  for (const r of results) {
    for (const m of r.missing) {
      const e = tally.get(m.key);
      if (e) e.count++;
      else tally.set(m.key, { label: m.label, count: 1 });
    }
  }
  return Array.from(tally.entries())
    .map(([key, v]) => ({ key, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count);
}
