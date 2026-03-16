/** Dilly CSV template columns — maps CSV headers to prospect DB fields */
export const PROSPECT_CSV_COLUMNS = [
  { csvHeader: "company_name", dbField: "company_name", label: "Company Name", required: true },
  { csvHeader: "contact_first_name", dbField: "contact_first_name", label: "Contact First Name", required: false },
  { csvHeader: "contact_last_name", dbField: "contact_last_name", label: "Contact Last Name", required: false },
  { csvHeader: "contact_title", dbField: "contact_title", label: "Contact Title", required: false },
  { csvHeader: "contact_email", dbField: "email", label: "Contact Email", required: false },
  { csvHeader: "contact_phone", dbField: "phone", label: "Contact Phone", required: false },
  { csvHeader: "contact_linkedin", dbField: "linkedin_url", label: "Contact LinkedIn", required: false },
  { csvHeader: "website", dbField: "website", label: "Website", required: false },
  { csvHeader: "address_line1", dbField: "address_line1", label: "Address", required: false },
  { csvHeader: "city", dbField: "city", label: "City", required: false },
  { csvHeader: "state", dbField: "state", label: "State", required: false },
  { csvHeader: "postal_code", dbField: "postal_code", label: "Postal Code", required: false },
  { csvHeader: "account_type", dbField: "account_type", label: "Account Type", required: false },
  { csvHeader: "vertical", dbField: "vertical", label: "Vertical", required: false },
  { csvHeader: "notes", dbField: "notes", label: "Notes", required: false },
] as const;

/** All DB fields that a CSV column can map to */
export const MAPPABLE_DB_FIELDS = PROSPECT_CSV_COLUMNS
  .filter((c) => c.dbField !== null)
  .map((c) => ({ value: c.dbField!, label: c.label }));

export const PROSPECT_STATUS_LABELS: Record<string, string> = {
  unworked: "Unworked",
  queued: "Queued",
  converted: "Converted",
  dismissed: "Dismissed",
};

export const PROSPECT_STATUS_COLORS: Record<string, string> = {
  unworked: "bg-slate-100 text-slate-700",
  queued: "bg-blue-100 text-blue-700",
  converted: "bg-green-100 text-green-700",
  dismissed: "bg-red-100 text-red-700",
};

/** Normalize a URL to a bare domain for dedup matching */
export function normalizeDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  let d = url.trim().toLowerCase();
  // strip protocol
  d = d.replace(/^https?:\/\//, "");
  // strip www.
  d = d.replace(/^www\./, "");
  // strip trailing slash and path
  d = d.replace(/\/.*$/, "");
  // strip port
  d = d.replace(/:\d+$/, "");
  return d || null;
}
