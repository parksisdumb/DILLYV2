import { inngest } from "../client";
import { createAdminClient } from "@/lib/supabase/admin";

// Metro area expansions — territory city "memphis" matches suburbs too
const METRO_AREAS: Record<string, string[]> = {
  memphis: ["memphis", "germantown", "bartlett", "collierville", "southaven", "olive branch", "horn lake", "cordova", "eads", "lakeland", "arlington", "millington"],
  nashville: ["nashville", "brentwood", "franklin", "murfreesboro", "hendersonville", "smyrna", "antioch", "nolensville", "gallatin", "mt. juliet", "spring hill"],
  dallas: ["dallas", "fort worth", "arlington", "plano", "frisco", "mckinney", "garland", "irving", "carrollton", "denton", "richardson", "farmers branch", "mesquite"],
  houston: ["houston", "sugar land", "pearland", "pasadena", "katy", "the woodlands", "conroe", "league city", "spring", "humble", "baytown", "cypress"],
  atlanta: ["atlanta", "sandy springs", "roswell", "alpharetta", "marietta", "smyrna", "peachtree city", "duluth", "kennesaw", "lawrenceville", "decatur", "norcross"],
  charlotte: ["charlotte", "concord", "gastonia", "rock hill", "huntersville", "matthews", "mooresville", "cornelius", "indian trail", "mint hill"],
  tampa: ["tampa", "st. petersburg", "clearwater", "brandon", "riverview", "wesley chapel", "lakeland", "plant city", "temple terrace", "palm harbor"],
  denver: ["denver", "aurora", "lakewood", "thornton", "arvada", "westminster", "pueblo", "centennial", "highlands ranch", "broomfield", "littleton", "parker"],
  phoenix: ["phoenix", "scottsdale", "mesa", "chandler", "gilbert", "tempe", "glendale", "peoria", "surprise", "goodyear", "buckeye", "avondale"],
  indianapolis: ["indianapolis", "carmel", "fishers", "noblesville", "greenwood", "lawrence", "brownsburg", "westfield", "avon", "plainfield"],
};

// Build reverse lookup: suburb → metro city
const SUBURB_TO_METRO = new Map<string, string>();
for (const [metro, suburbs] of Object.entries(METRO_AREAS)) {
  for (const suburb of suburbs) {
    SUBURB_TO_METRO.set(suburb, metro);
  }
}

// ── Intel Distributor ────────────────────────────────────────────────────────
// Reads intel_prospects and distributes matching records to orgs based on
// their territory geography and ICP criteria. Runs nightly or on-demand.

export const intelDistributor = inngest.createFunction(
  {
    id: "intel-distributor",
    retries: 1,
    triggers: [{ event: "app/intel-distributor.run" }],
  },
  async ({ event, step }) => {
    const supabase = createAdminClient();
    const targetOrgId = event.data?.org_id as string | undefined;

    // ── Step: Load orgs ──────────────────────────────────────────────────
    const orgs = await step.run("load-orgs", async () => {
      if (targetOrgId) {
        console.log(`[distributor] Running for single org: ${targetOrgId}`);
        return [{ id: targetOrgId }];
      }

      const { data } = await supabase
        .from("orgs")
        .select("id");
      console.log(`[distributor] Found ${data?.length ?? 0} orgs`);
      return (data ?? []).map((o) => ({ id: o.id as string }));
    });

    // ── Step: Distribute per org ─────────────────────────────────────────
    const results = await step.run("distribute", async () => {
      const orgResults: Record<string, { matched: number; pushed: number; skipped: number }> = {};

      for (const org of orgs) {
        const orgId = org.id;
        console.log(`[distributor] Processing org ${orgId}`);

        // Fetch territory regions for this org
        const { data: territories } = await supabase
          .from("territories")
          .select("id")
          .eq("org_id", orgId)
          .eq("active", true);

        const territoryIds = (territories ?? []).map((t) => t.id as string);

        let regions: { region_type: string; region_value: string; state: string }[] = [];
        if (territoryIds.length > 0) {
          const { data: r } = await supabase
            .from("territory_regions")
            .select("region_type,region_value,state")
            .in("territory_id", territoryIds);
          regions = (r ?? []) as typeof regions;
        }

        if (regions.length === 0) {
          console.log(`[distributor] Org ${orgId}: no territory regions, skipping`);
          orgResults[orgId] = { matched: 0, pushed: 0, skipped: 0 };
          continue;
        }

        // Build geography filters
        const postalCodes = regions
          .filter((r) => r.region_type === "zip")
          .map((r) => r.region_value);
        const cities = regions
          .filter((r) => r.region_type === "city")
          .map((r) => r.region_value.toLowerCase());
        const stateRegions = regions
          .filter((r) => r.region_type === "state")
          .map((r) => r.region_value.toLowerCase());
        const allStates = [
          ...new Set([
            ...regions.map((r) => r.state.toLowerCase()),
            ...stateRegions,
          ]),
        ];

        // Fetch ICP criteria for this org
        const { data: icpProfiles } = await supabase
          .from("icp_profiles")
          .select("id")
          .eq("org_id", orgId)
          .eq("active", true);

        const profileIds = (icpProfiles ?? []).map((p) => p.id as string);

        let criteria: { criteria_type: string; criteria_value: string }[] = [];
        if (profileIds.length > 0) {
          const { data: c } = await supabase
            .from("icp_criteria")
            .select("criteria_type,criteria_value")
            .in("icp_profile_id", profileIds);
          criteria = (c ?? []) as typeof criteria;
        }

        const icpAccountTypes = criteria
          .filter((c) => c.criteria_type === "account_type")
          .map((c) => c.criteria_value.toLowerCase());
        const icpVerticals = criteria
          .filter((c) => c.criteria_type === "vertical")
          .map((c) => c.criteria_value.toLowerCase());

        // Query intel_prospects matching geography (no state pre-filter — match in JS)
        const { data: candidates } = await supabase
          .from("intel_prospects")
          .select("*")
          .eq("status", "active")
          .gte("confidence_score", 40)
          .is("dilly_org_id", null)
          .limit(500);

        if (!candidates || candidates.length === 0) {
          console.log(`[distributor] Org ${orgId}: no matching intel_prospects`);
          orgResults[orgId] = { matched: 0, pushed: 0, skipped: 0 };
          continue;
        }

        // Build expanded city set: territory cities + their metro suburbs
        const expandedCities = new Set<string>();
        for (const city of cities) {
          expandedCities.add(city);
          const metros = METRO_AREAS[city];
          if (metros) {
            for (const suburb of metros) expandedCities.add(suburb);
          }
        }

        // Filter by geography (case-insensitive) with metro expansion
        let metroExpansionCount = 0;
        const matched = candidates.filter((p) => {
          const pState = (p.state as string | null)?.toLowerCase();
          const pCity = (p.city as string | null)?.toLowerCase();
          const pZip = p.postal_code as string | null;

          // State-type region: match any prospect in that state
          const stateMatch = pState && stateRegions.includes(pState);
          const inState = pState && allStates.includes(pState);

          // City match: exact OR metro area expansion
          let cityMatch = false;
          if (pCity && expandedCities.has(pCity)) {
            cityMatch = true;
            // Log metro expansion (not exact territory city)
            if (!cities.includes(pCity)) metroExpansionCount++;
          }

          const zipMatch = pZip && postalCodes.includes(pZip);
          const geoMatch = stateMatch || (inState && (cityMatch || zipMatch));

          if (!geoMatch) return false;

          // ICP criteria matching (if criteria exist)
          if (icpAccountTypes.length > 0 || icpVerticals.length > 0) {
            const pType = (p.account_type as string | null)?.toLowerCase();
            const pVertical = (p.vertical as string | null)?.toLowerCase();

            const typeMatch =
              icpAccountTypes.length === 0 ||
              (pType && icpAccountTypes.includes(pType));
            const vertMatch =
              icpVerticals.length === 0 ||
              (pVertical && icpVerticals.includes(pVertical));

            return typeMatch || vertMatch;
          }

          return true;
        });

        if (metroExpansionCount > 0) {
          console.log(
            `[distributor] Org ${orgId}: ${metroExpansionCount} prospects matched via metro area expansion`
          );
        }

        console.log(
          `[distributor] Org ${orgId}: ${candidates.length} candidates → ${matched.length} matched`
        );

        let pushed = 0;
        let skipped = 0;

        for (const row of matched) {
          // Insert into org-scoped prospects table
          const { data: newProspect, error: insertErr } = await supabase
            .from("prospects")
            .insert({
              org_id: orgId,
              company_name: row.company_name,
              website: row.company_website,
              domain_normalized: row.domain_normalized,
              email: row.contact_email,
              phone: row.contact_phone ?? row.company_phone,
              contact_first_name: row.contact_first_name,
              contact_last_name: row.contact_last_name,
              contact_title: row.contact_title,
              address_line1: row.address_line1,
              city: row.city,
              state: row.state,
              postal_code: row.postal_code,
              account_type: row.account_type,
              vertical: row.vertical,
              source: "agent",
              source_detail: row.source_detail,
              confidence_score: row.confidence_score,
              agent_metadata: {
                intel_prospect_id: row.id,
                score_breakdown: row.score_breakdown,
              },
            })
            .select("id")
            .single();

          if (insertErr) {
            // Duplicate — skip silently
            skipped++;
            continue;
          }

          // Mark intel_prospect as pushed to this org
          await supabase
            .from("intel_prospects")
            .update({ status: "pushed", dilly_org_id: orgId, dilly_prospect_id: newProspect.id })
            .eq("id", row.id);

          pushed++;
        }

        console.log(
          `[distributor] Org ${orgId}: pushed=${pushed} skipped=${skipped}`
        );
        orgResults[orgId] = { matched: matched.length, pushed, skipped };
      }

      return orgResults;
    });

    // ── Step: Log results ────────────────────────────────────────────────
    await step.run("log-results", async () => {
      const totalPushed = Object.values(results).reduce((s, r) => s + r.pushed, 0);
      const totalMatched = Object.values(results).reduce((s, r) => s + r.matched, 0);

      console.log(
        `[distributor] Done: ${Object.keys(results).length} orgs, ${totalMatched} matched, ${totalPushed} pushed`
      );

      // Create an agent_runs record for tracking
      const { data: firstOrg } = await supabase
        .from("orgs")
        .select("id")
        .limit(1)
        .single();

      await supabase.from("agent_runs").insert({
        org_id: targetOrgId ?? firstOrg?.id,
        run_type: "distribution",
        status: "completed",
        prospects_found: totalMatched,
        prospects_added: totalPushed,
        prospects_skipped_dedup: Object.values(results).reduce((s, r) => s + r.skipped, 0),
        source_breakdown: results,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
    });
  }
);
