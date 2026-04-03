"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const COMPANY_TYPES = [
  { value: "commercial_property_management", label: "Property Management Companies" },
  { value: "owner", label: "Building Owners (Direct)" },
  { value: "facilities_management", label: "Facilities Management Companies" },
  { value: "asset_management", label: "REITs / Institutional Investors" },
  { value: "general_contractor", label: "General Contractors" },
  { value: "corporate_campus", label: "Corporate Campus Owners" },
  { value: "government", label: "Government / Municipal Buildings" },
  { value: "healthcare", label: "Healthcare Facilities" },
  { value: "industrial_warehouse", label: "Industrial / Warehouse Owners" },
  { value: "retail", label: "Retail Property Owners" },
  { value: "self_storage", label: "Self-Storage Operators" },
  { value: "education", label: "Educational Institutions" },
];

const SQ_FT_OPTIONS = [
  { value: "", label: "No minimum" },
  { value: "10000", label: "10,000+ sqft" },
  { value: "25000", label: "25,000+ sqft" },
  { value: "50000", label: "50,000+ sqft" },
  { value: "100000", label: "100,000+ sqft" },
];

const DEAL_SIZE_OPTIONS = [
  { value: "small", label: "Under $25K" },
  { value: "medium", label: "$25K - $100K" },
  { value: "large", label: "$100K - $500K" },
  { value: "enterprise", label: "$500K+" },
];

const ROOF_TYPES = [
  { value: "tpo", label: "TPO" },
  { value: "epdm", label: "EPDM" },
  { value: "metal", label: "Metal" },
  { value: "bur", label: "BUR (Built-Up)" },
  { value: "mod_bit", label: "Modified Bitumen" },
  { value: "spf", label: "SPF (Spray Foam)" },
  { value: "all", label: "All Types" },
];

const DECISION_MAKERS = [
  { value: "property_manager", label: "Property Manager" },
  { value: "facilities_director", label: "Facilities Director" },
  { value: "asset_manager", label: "Asset Manager" },
  { value: "vp_operations", label: "VP Operations" },
  { value: "director_capital_projects", label: "Director Capital Projects" },
  { value: "owner_principal", label: "Owner / Principal" },
  { value: "building_engineer", label: "Building Engineer" },
];

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

export default function IcpSetupClient({
  orgId,
  userId,
  prefillStates,
}: {
  orgId: string;
  userId: string;
  prefillStates: string[];
}) {
  const router = useRouter();
  const supabase = createBrowserSupabase();

  const [companyTypes, setCompanyTypes] = useState<Set<string>>(new Set());
  const [states, setStates] = useState<Set<string>>(new Set(prefillStates));
  const [minSqft, setMinSqft] = useState("");
  const [dealSize, setDealSize] = useState("");
  const [roofTypes, setRoofTypes] = useState<Set<string>>(new Set());
  const [decisionMakers, setDecisionMakers] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(1);

  function toggleSet<T>(set: Set<T>, val: T, setter: (s: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    setter(next);
  }

  async function handleSubmit() {
    if (companyTypes.size === 0) return;
    setBusy(true);

    // Create ICP profile
    const { data: profile, error: profileErr } = await supabase
      .from("icp_profiles")
      .insert({
        org_id: orgId,
        name: "Primary ICP",
        active: true,
        created_by: userId,
      })
      .select("id")
      .single();

    if (profileErr || !profile) {
      setBusy(false);
      return;
    }

    // Build criteria rows
    const criteria: { icp_profile_id: string; criteria_type: string; criteria_value: string }[] = [];

    for (const type of companyTypes) {
      criteria.push({ icp_profile_id: profile.id, criteria_type: "account_type", criteria_value: type });
    }
    for (const state of states) {
      criteria.push({ icp_profile_id: profile.id, criteria_type: "state", criteria_value: state });
    }
    if (minSqft) {
      criteria.push({ icp_profile_id: profile.id, criteria_type: "property_size_min", criteria_value: minSqft });
    }
    if (dealSize) {
      criteria.push({ icp_profile_id: profile.id, criteria_type: "deal_size", criteria_value: dealSize });
    }
    for (const rt of roofTypes) {
      criteria.push({ icp_profile_id: profile.id, criteria_type: "roof_type", criteria_value: rt });
    }
    for (const dm of decisionMakers) {
      criteria.push({ icp_profile_id: profile.id, criteria_type: "decision_role", criteria_value: dm });
    }

    if (criteria.length > 0) {
      await supabase.from("icp_criteria").insert(criteria);
    }

    setBusy(false);
    router.push("/app/manager");
  }

  const chipBase = "rounded-xl border px-3 py-2 text-sm font-medium transition-colors cursor-pointer";
  const chipOff = "border-slate-200 bg-white text-slate-700 hover:bg-slate-50";
  const chipOn = "border-blue-400 bg-blue-50 text-blue-700";

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-bold text-slate-900">Who are you targeting right now?</h1>
      <p className="mt-1 text-sm text-slate-500">
        This helps Dilly sort your prospect list. Update it anytime as you learn what works.
      </p>

      {/* Progress bar */}
      <div className="mt-4 flex gap-1">
        {[1, 2, 3, 4, 5, 6].map((s) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full ${s <= step ? "bg-blue-600" : "bg-slate-200"}`}
          />
        ))}
      </div>

      <div className="mt-6 space-y-6">
        {/* Q1: Company types */}
        {step >= 1 && (
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              What types of companies do you target?
            </label>
            <div className="flex flex-wrap gap-2">
              {COMPANY_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => { toggleSet(companyTypes, t.value, setCompanyTypes); if (step < 2) setStep(2); }}
                  className={`${chipBase} ${companyTypes.has(t.value) ? chipOn : chipOff}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Q2: States */}
        {step >= 2 && (
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              What states do you serve?
            </label>
            <div className="flex flex-wrap gap-1.5">
              {US_STATES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { toggleSet(states, s, setStates); if (step < 3) setStep(3); }}
                  className={`rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${
                    states.has(s) ? "border-blue-400 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Q3: Minimum building size */}
        {step >= 3 && (
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              Minimum building size?
            </label>
            <div className="flex flex-wrap gap-2">
              {SQ_FT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { setMinSqft(o.value); if (step < 4) setStep(4); }}
                  className={`${chipBase} ${minSqft === o.value ? chipOn : chipOff}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Q4: Deal size */}
        {step >= 4 && (
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              Typical deal size?
            </label>
            <div className="flex flex-wrap gap-2">
              {DEAL_SIZE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { setDealSize(o.value); if (step < 5) setStep(5); }}
                  className={`${chipBase} ${dealSize === o.value ? chipOn : chipOff}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Q5: Roof types */}
        {step >= 5 && (
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              Roof types you specialize in?
            </label>
            <div className="flex flex-wrap gap-2">
              {ROOF_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => { toggleSet(roofTypes, t.value, setRoofTypes); if (step < 6) setStep(6); }}
                  className={`${chipBase} ${roofTypes.has(t.value) ? chipOn : chipOff}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Q6: Decision makers */}
        {step >= 6 && (
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              Who approves roofing work?
            </label>
            <div className="flex flex-wrap gap-2">
              {DECISION_MAKERS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleSet(decisionMakers, d.value, setDecisionMakers)}
                  className={`${chipBase} ${decisionMakers.has(d.value) ? chipOn : chipOff}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Submit */}
        {step >= 6 && (
          <button
            type="button"
            disabled={busy || companyTypes.size === 0}
            onClick={handleSubmit}
            className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Saving..." : "Save & Start Scoring"}
          </button>
        )}
      </div>
    </div>
  );
}
