// Account onboarding / vendor-compliance status.
//
// Separate from accounts.status (active/inactive) and from any pipeline stage.
// Tracks how far a vendor relationship has progressed through paperwork/compliance.

export const ONBOARDING_STATUS_ORDER = [
  "initial_touch",
  "paperwork_started",
  "paperwork_received",
  "paperwork_finished",
  "compliant",
] as const;

export type OnboardingStatus = (typeof ONBOARDING_STATUS_ORDER)[number];

export const ONBOARDING_STATUS_LABELS: Record<string, string> = {
  initial_touch: "Initial Touch",
  paperwork_started: "Onboarding Paperwork Started",
  paperwork_received: "Onboarding Paperwork Received",
  paperwork_finished: "Onboarding Paperwork Finished",
  compliant: "Compliant / Active Vendor",
};

// Short labels for tight spaces (list badges, chips).
export const ONBOARDING_STATUS_SHORT: Record<string, string> = {
  initial_touch: "Initial Touch",
  paperwork_started: "Paperwork Started",
  paperwork_received: "Paperwork Received",
  paperwork_finished: "Paperwork Finished",
  compliant: "Compliant",
};

export const ONBOARDING_STATUS_COLORS: Record<string, string> = {
  initial_touch: "bg-slate-100 text-slate-700",
  paperwork_started: "bg-amber-100 text-amber-800",
  paperwork_received: "bg-blue-100 text-blue-700",
  paperwork_finished: "bg-indigo-100 text-indigo-700",
  compliant: "bg-green-100 text-green-700",
};

export const DEFAULT_ONBOARDING_STATUS: OnboardingStatus = "initial_touch";

export const ONBOARDING_STATUS_OPTIONS = ONBOARDING_STATUS_ORDER.map((value) => ({
  value,
  label: ONBOARDING_STATUS_LABELS[value],
}));

export function onboardingLabel(status: string | null | undefined): string {
  if (!status) return ONBOARDING_STATUS_LABELS.initial_touch;
  return ONBOARDING_STATUS_LABELS[status] ?? status;
}
