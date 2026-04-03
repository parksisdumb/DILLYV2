// Outcome taxonomy: which outcomes appear for which touchpoint type,
// and what auto-action follows each outcome.

export type OutcomeConfig = {
  key: string;
  label: string;
  shortLabel: string;
  /** Days until auto next-action. null = no auto-action. */
  autoNextDays: number | null;
  /** If true, outcome creates an opportunity milestone */
  createsMilestone: boolean;
};

// Outcomes grouped by touchpoint type key
export const OUTCOMES_BY_TYPE: Record<string, OutcomeConfig[]> = {
  call: [
    { key: "connected_conversation", label: "Connected — had a conversation", shortLabel: "Connected", autoNextDays: 3, createsMilestone: false },
    { key: "no_answer_voicemail", label: "No Answer — left voicemail", shortLabel: "Left VM", autoNextDays: 2, createsMilestone: false },
    { key: "no_answer_no_voicemail", label: "No Answer — no voicemail", shortLabel: "No Answer", autoNextDays: 1, createsMilestone: false },
    { key: "gatekeeper", label: "Gatekeeper — couldn't get through", shortLabel: "Gatekeeper", autoNextDays: 2, createsMilestone: false },
    { key: "inspection_scheduled", label: "Scheduled — booked inspection", shortLabel: "Scheduled", autoNextDays: null, createsMilestone: true },
    { key: "callback_requested", label: "Call Back Later", shortLabel: "Call Back", autoNextDays: 1, createsMilestone: false },
    { key: "not_interested", label: "Not Interested", shortLabel: "Not Interested", autoNextDays: null, createsMilestone: false },
  ],
  email: [
    { key: "email_sent", label: "Sent", shortLabel: "Sent", autoNextDays: 3, createsMilestone: false },
    { key: "email_replied", label: "Got a Reply", shortLabel: "Replied", autoNextDays: 1, createsMilestone: false },
    { key: "email_bounced", label: "Bounced", shortLabel: "Bounced", autoNextDays: null, createsMilestone: false },
  ],
  text: [
    { key: "connected_conversation", label: "Got a Reply", shortLabel: "Replied", autoNextDays: 1, createsMilestone: false },
    { key: "email_sent", label: "Sent — no reply", shortLabel: "Sent", autoNextDays: 2, createsMilestone: false },
  ],
  door_knock: [
    { key: "met_in_person", label: "Met in Person", shortLabel: "Met", autoNextDays: 3, createsMilestone: false },
    { key: "not_available", label: "Not There", shortLabel: "Not There", autoNextDays: 2, createsMilestone: false },
    { key: "inspection_scheduled", label: "Scheduled Follow-up", shortLabel: "Scheduled", autoNextDays: null, createsMilestone: true },
  ],
  site_visit: [
    { key: "met_in_person", label: "Met in Person", shortLabel: "Met", autoNextDays: 3, createsMilestone: false },
    { key: "not_available", label: "Not There", shortLabel: "Not There", autoNextDays: 2, createsMilestone: false },
    { key: "inspection_scheduled", label: "Scheduled Follow-up", shortLabel: "Scheduled", autoNextDays: null, createsMilestone: true },
  ],
};

// Fallback for types not in the map
export const DEFAULT_OUTCOMES: OutcomeConfig[] = [
  { key: "connected_conversation", label: "Connected", shortLabel: "Connected", autoNextDays: 3, createsMilestone: false },
  { key: "no_answer_voicemail", label: "No Answer", shortLabel: "No Answer", autoNextDays: 1, createsMilestone: false },
];

export function getOutcomesForType(typeKey: string): OutcomeConfig[] {
  return OUTCOMES_BY_TYPE[typeKey] ?? DEFAULT_OUTCOMES;
}

export function getAutoNextDays(outcomeKey: string, typeKey: string): number | null {
  const outcomes = getOutcomesForType(typeKey);
  const config = outcomes.find((o) => o.key === outcomeKey);
  return config?.autoNextDays ?? null;
}

export function getNextActionLabel(outcomeKey: string, typeKey: string): string | null {
  const days = getAutoNextDays(outcomeKey, typeKey);
  if (days === null) return null;
  if (days === 1) return "Follow up tomorrow";
  return `Follow up in ${days} days`;
}
