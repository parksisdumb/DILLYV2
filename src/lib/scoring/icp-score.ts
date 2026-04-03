// ICP Scoring — prioritization tool, not a filter.
// Every account gets called. Priority 1 gets called first.

export type IcpScoreResult = {
  score: number;
  priority: 1 | 2 | 3 | 4;
  label: string;
  matches: string[];
  misses: string[];
};

export type IcpCriteria = {
  criteria_type: string;
  criteria_value: string;
};

export type ScorableAccount = {
  account_type?: string | null;
  state?: string | null; // from linked properties
  sq_footage?: number | null; // largest property
  roof_type?: string | null;
  contact_title?: string | null; // primary contact title
};

const PRIORITY_LABELS: Record<number, string> = {
  1: "Call first",
  2: "Strong prospect",
  3: "Worth a conversation",
  4: "Low priority — still call",
};

export function scoreAccount(
  account: ScorableAccount,
  criteria: IcpCriteria[]
): IcpScoreResult {
  if (criteria.length === 0) {
    return { score: 50, priority: 3, label: PRIORITY_LABELS[3], matches: [], misses: ["No ICP configured"] };
  }

  let score = 0;
  const matches: string[] = [];
  const misses: string[] = [];

  // Group criteria by type
  const byType = new Map<string, string[]>();
  for (const c of criteria) {
    if (!byType.has(c.criteria_type)) byType.set(c.criteria_type, []);
    byType.get(c.criteria_type)!.push(c.criteria_value.toLowerCase());
  }

  // account_type match: 30pts
  const targetTypes = byType.get("account_type") ?? [];
  if (targetTypes.length > 0) {
    if (account.account_type && targetTypes.includes(account.account_type.toLowerCase())) {
      score += 30;
      matches.push("Account type matches ICP");
    } else {
      misses.push("Account type not in ICP targets");
    }
  }

  // state match: 20pts
  const targetStates = byType.get("state") ?? [];
  if (targetStates.length > 0) {
    if (account.state && targetStates.includes(account.state.toLowerCase())) {
      score += 20;
      matches.push("In target state");
    } else {
      misses.push("Not in target states");
    }
  }

  // sq_footage match: 20pts
  const minSqft = byType.get("property_size_min")?.[0];
  if (minSqft) {
    const minVal = parseInt(minSqft, 10);
    if (account.sq_footage && account.sq_footage >= minVal) {
      score += 20;
      matches.push(`Property ${(account.sq_footage / 1000).toFixed(0)}K+ sqft`);
    } else if (account.sq_footage) {
      misses.push(`Property below ${(minVal / 1000).toFixed(0)}K sqft minimum`);
    } else {
      misses.push("No property size data");
    }
  }

  // roof_type match: 15pts
  const targetRoofTypes = byType.get("roof_type") ?? [];
  if (targetRoofTypes.length > 0) {
    if (account.roof_type && targetRoofTypes.includes(account.roof_type.toLowerCase())) {
      score += 15;
      matches.push("Roof type matches specialty");
    } else if (account.roof_type) {
      misses.push("Roof type not in specialties");
    }
  }

  // decision_maker title match: 15pts
  const targetRoles = byType.get("decision_role") ?? [];
  if (targetRoles.length > 0) {
    if (account.contact_title) {
      const titleLower = account.contact_title.toLowerCase();
      const roleMatch = targetRoles.some(
        (role) => titleLower.includes(role) || role.includes(titleLower)
      );
      if (roleMatch) {
        score += 15;
        matches.push("Decision maker title matches");
      } else {
        misses.push("Contact title doesn't match target roles");
      }
    } else {
      misses.push("No contact title data");
    }
  }

  score = Math.min(100, Math.max(0, score));

  const priority: 1 | 2 | 3 | 4 =
    score >= 80 ? 1 : score >= 60 ? 2 : score >= 40 ? 3 : 4;

  return {
    score,
    priority,
    label: PRIORITY_LABELS[priority],
    matches,
    misses,
  };
}

// Priority badge colors for UI
export const PRIORITY_COLORS: Record<number, string> = {
  1: "bg-green-100 text-green-700 border-green-200",
  2: "bg-blue-100 text-blue-700 border-blue-200",
  3: "bg-amber-100 text-amber-700 border-amber-200",
  4: "bg-slate-100 text-slate-500 border-slate-200",
};

export const PRIORITY_LABELS_SHORT: Record<number, string> = {
  1: "P1",
  2: "P2",
  3: "P3",
  4: "P4",
};
