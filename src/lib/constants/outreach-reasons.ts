/** Maps reason_codes stored in suggested_outreach.reason_codes to human-readable labels */
export const REASON_CODE_LABELS: Record<string, string> = {
  icp_match: "ICP match",
  unworked: "Unworked",
  imported_this_week: "Added this week",
  high_confidence: "High confidence",
  territory_match: "In your territory",
  manager_pick: "Manager pick",
};

/** Dismiss reason options for reps */
export const DISMISS_REASONS = [
  { value: "not_a_fit", label: "Not a fit" },
  { value: "already_working", label: "Already working them" },
  { value: "duplicate", label: "Duplicate" },
  { value: "other", label: "Other" },
] as const;
