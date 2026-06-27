// ICP Scoring — prioritization tool, NOT a filter. Every account gets called;
// Priority 1 gets called first. ICP orders the queue, it never hides anyone.
//
// Intrinsic value model for commercial roofing: the two factors that actually
// predict LTV dominate — PORTFOLIO SIZE (number of linked properties) and
// ACCOUNT-TYPE FIT (PM / Asset Mgmt / Owner are the highest-LTV channels) — with
// engagement/recency and contact depth as modifiers. No dependency on whether ICP
// criteria were configured "correctly"; a 44-property property-management portfolio
// is top priority regardless.

export type IcpScoreResult = {
  score: number;
  priority: 1 | 2 | 3 | 4;
  label: string; // reason, e.g. "Large property-management portfolio (79 properties)"
  matches: string[]; // positive drivers
  misses: string[]; // gaps holding it back
};

export type ScorableAccount = {
  account_type?: string | null;
  property_count?: number | null; // linked properties = portfolio size (heaviest signal)
  contact_count?: number | null;
  last_touch_at?: string | null; // ISO timestamp of most recent touchpoint
};

// Account-type fit (max 35). Highest-LTV channels first.
const TYPE_FIT: Record<string, number> = {
  commercial_property_management: 35,
  asset_management: 35,
  owner: 35,
  facilities_management: 28,
  general_contractor: 20,
  developer: 20,
  broker: 18,
  consultant: 18,
  vendor: 6,
  other: 6,
};

const TYPE_LABEL: Record<string, string> = {
  commercial_property_management: "Property management",
  asset_management: "Asset management",
  owner: "Owner",
  facilities_management: "Facilities management",
  general_contractor: "General contractor",
  developer: "Developer",
  broker: "Broker",
  consultant: "Consultant",
  vendor: "Vendor",
  other: "Other",
};

const DAY = 86_400_000;

function typeFitPoints(t?: string | null): number {
  if (!t) return 6;
  return TYPE_FIT[t.toLowerCase()] ?? 6;
}

// Heavy, curved — big portfolios clearly win (not linear).
function portfolioPoints(n: number): number {
  if (n >= 20) return 40;
  if (n >= 10) return 30;
  if (n >= 3) return 18;
  if (n >= 1) return 8;
  return 0;
}

function engagementPoints(iso: string | null | undefined, now: number): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  const days = (now - t) / DAY;
  if (days <= 30) return 15;
  if (days <= 90) return 10;
  if (days <= 180) return 5;
  return 3;
}

function contactPoints(n: number): number {
  if (n >= 5) return 10;
  if (n >= 3) return 7;
  if (n >= 1) return 4;
  return 0;
}

export function scoreAccount(a: ScorableAccount, now: number = Date.now()): IcpScoreResult {
  const props = Math.max(0, a.property_count ?? 0);
  const contacts = Math.max(0, a.contact_count ?? 0);

  const typePts = typeFitPoints(a.account_type);
  const portPts = portfolioPoints(props);
  const engPts = engagementPoints(a.last_touch_at, now);
  const conPts = contactPoints(contacts);

  const score = Math.min(100, Math.max(0, typePts + portPts + engPts + conPts));
  const priority: 1 | 2 | 3 | 4 = score >= 80 ? 1 : score >= 60 ? 2 : score >= 40 ? 3 : 4;

  const typeName = TYPE_LABEL[(a.account_type ?? "").toLowerCase()] ?? "Unknown type";
  const matches: string[] = [];
  const misses: string[] = [];

  if (props >= 20) matches.push(`Large portfolio — ${props} properties`);
  else if (props >= 10) matches.push(`${props}-property portfolio`);
  else if (props >= 3) matches.push(`${props} linked properties`);
  else if (props >= 1) misses.push(`Small portfolio (${props} propert${props === 1 ? "y" : "ies"})`);
  else misses.push("No linked properties");

  if (typePts >= 28) matches.push(`${typeName} — top-value channel`);
  else if (typePts >= 18) matches.push(`${typeName} — mid-value channel`);
  else misses.push(`${typeName} — lower-value channel`);

  if (engPts >= 10) matches.push("Active relationship");
  else if (engPts === 0) misses.push("No touchpoints yet");

  if (conPts >= 7) matches.push(`${contacts} known contacts`);
  else if (contacts === 0) misses.push("No contacts on file");

  // Dominant-driver reason for the "Priority N — [reason]" line.
  let reason: string;
  if (props >= 10 && typePts >= 28) reason = `Large ${typeName.toLowerCase()} portfolio (${props} properties)`;
  else if (props >= 10) reason = `${props}-property portfolio`;
  else if (typePts >= 28 && props >= 3) reason = `${typeName} with ${props} properties`;
  else if (typePts >= 28) reason = `${typeName}, small footprint`;
  else if (props >= 3) reason = `${props}-property ${typeName.toLowerCase()}`;
  else reason = `${typeName}, limited footprint`;

  return { score, priority, label: reason, matches, misses };
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
