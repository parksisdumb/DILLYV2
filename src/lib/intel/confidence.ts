// Confidence scoring engine for intel_prospects
// Pure function — no side effects, no DB access

export type IntelProspect = {
  company_name: string;
  domain_normalized?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  contact_title?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  account_type?: string | null;
  vertical?: string | null;
  building_type?: string | null;
  building_sq_footage?: number | null;
  roof_age_years?: number | null;
  storm_priority?: boolean;
  new_owner_signal?: boolean;
  lat?: number | null;
  lng?: number | null;
  owner_name_legal?: string | null;
};

export type IcpCriteria = {
  criteria_type: string;
  criteria_value: string;
};

export type ScoreResult = {
  score: number;
  breakdown: string[];
};

// Source base scores — how trustworthy each data source is
const SOURCE_BASE_SCORES: Record<string, number> = {
  edgar_10k: 50,
  cms_healthcare: 50,
  hifld: 50,
  gsa_frpp: 50,
  usda_fsis: 45,
  county_assessor: 45,
  deed_transfer: 45,
  apartments_pmc: 40,
  irem_amo: 42,
  nareit: 45,
  loopnet: 38,
  crexi: 38,
  storagecafe: 38,
  google_places: 30,
  edgar_form_d: 28,
  web_intelligence: 15,
  openstreetmap: 10,
  batchdata: 55,
  proptracer: 55,
};

/**
 * Score a prospect against ICP criteria + signal bonuses + penalties.
 * Does NOT include source base score — use scoreWithSource() for that.
 */
export function scoreProspect(
  prospect: IntelProspect,
  icpCriteria?: IcpCriteria[]
): ScoreResult {
  let score = 0;
  const breakdown: string[] = [];

  // ── ICP bonuses (only when criteria provided) ──────────────────────────
  if (icpCriteria && icpCriteria.length > 0) {
    const criteriaByType = new Map<string, string[]>();
    for (const c of icpCriteria) {
      const existing = criteriaByType.get(c.criteria_type) ?? [];
      existing.push(c.criteria_value.toLowerCase());
      criteriaByType.set(c.criteria_type, existing);
    }

    // account_type match: +25
    const accountTypes = criteriaByType.get("account_type");
    if (
      accountTypes &&
      prospect.account_type &&
      accountTypes.includes(prospect.account_type.toLowerCase())
    ) {
      score += 25;
      breakdown.push("+25 account_type match");
    }

    // vertical match: +20
    const verticals = criteriaByType.get("vertical");
    if (
      verticals &&
      prospect.vertical &&
      verticals.includes(prospect.vertical.toLowerCase())
    ) {
      score += 20;
      breakdown.push("+20 vertical match");
    }

    // sq_footage in range: +15
    const sizeMin = criteriaByType.get("property_size_min");
    const sizeMax = criteriaByType.get("property_size_max");
    if (prospect.building_sq_footage && (sizeMin || sizeMax)) {
      const min = sizeMin ? parseInt(sizeMin[0], 10) : 0;
      const max = sizeMax ? parseInt(sizeMax[0], 10) : Infinity;
      if (prospect.building_sq_footage >= min && prospect.building_sq_footage <= max) {
        score += 15;
        breakdown.push("+15 sq_footage in range");
      }
    }

    // roof_age in range: +15
    const roofMin = criteriaByType.get("roof_age_min");
    const roofMax = criteriaByType.get("roof_age_max");
    if (prospect.roof_age_years && (roofMin || roofMax)) {
      const min = roofMin ? parseInt(roofMin[0], 10) : 0;
      const max = roofMax ? parseInt(roofMax[0], 10) : Infinity;
      if (prospect.roof_age_years >= min && prospect.roof_age_years <= max) {
        score += 15;
        breakdown.push("+15 roof_age in range");
      }
    }

    // building_type match: +10
    const buildingTypes = criteriaByType.get("building_type");
    if (
      buildingTypes &&
      prospect.building_type &&
      buildingTypes.includes(prospect.building_type.toLowerCase())
    ) {
      score += 10;
      breakdown.push("+10 building_type match");
    }

    // decision_role found in contact_title: +10
    const decisionRoles = criteriaByType.get("decision_role");
    if (decisionRoles && prospect.contact_title) {
      const titleLower = prospect.contact_title.toLowerCase();
      if (decisionRoles.some((role) => titleLower.includes(role))) {
        score += 10;
        breakdown.push("+10 decision_role match");
      }
    }
  }

  // ── Signal bonuses ─────────────────────────────────────────────────────
  if (prospect.storm_priority) {
    score += 20;
    breakdown.push("+20 storm_priority");
  }
  if (prospect.new_owner_signal) {
    score += 20;
    breakdown.push("+20 new_owner_signal");
  }
  if (prospect.contact_email) {
    score += 5;
    breakdown.push("+5 contact_email present");
  }
  if (prospect.contact_phone) {
    score += 5;
    breakdown.push("+5 contact_phone present");
  }
  if (prospect.lat != null && prospect.lng != null) {
    score += 5;
    breakdown.push("+5 lat/lng present");
  }

  // ── Penalties ──────────────────────────────────────────────────────────
  if (!prospect.address_line1 || !prospect.city || !prospect.state) {
    score -= 20;
    breakdown.push("-20 missing address");
  }
  if (
    prospect.owner_name_legal &&
    /\b(LLC|LP|Trust|Inc|Corp)\b/i.test(prospect.owner_name_legal) &&
    !prospect.contact_email &&
    !prospect.contact_phone &&
    !prospect.contact_first_name
  ) {
    score -= 10;
    breakdown.push("-10 entity owner w/o contact");
  }

  return { score, breakdown };
}

/**
 * Full scoring: source base score + ICP/signal scoring.
 * This is the main entry point for scoring.
 */
export function scoreWithSource(
  sourceType: string,
  prospect: IntelProspect,
  icpCriteria?: IcpCriteria[]
): ScoreResult {
  const baseScore = SOURCE_BASE_SCORES[sourceType] ?? 20;
  const { score: icpScore, breakdown } = scoreProspect(prospect, icpCriteria);
  const total = Math.max(0, Math.min(100, baseScore + icpScore));
  return {
    score: total,
    breakdown: [`+${baseScore} source:${sourceType}`, ...breakdown],
  };
}
