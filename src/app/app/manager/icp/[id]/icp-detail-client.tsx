"use client";

import { useState, useRef } from "react";
import {
  ICP_ACCOUNT_TYPES,
  ICP_VERTICALS,
  ICP_BUILDING_TYPES,
  ICP_DECISION_ROLES,
  CRITERIA_TYPE_LABELS,
} from "@/lib/constants/icp-options";

type Profile = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  territory_id: string | null;
};

type Criterion = {
  id: string;
  criteria_type: string;
  criteria_value: string;
};

type Territory = {
  id: string;
  name: string;
};

type Props = {
  profile: Profile;
  criteria: Criterion[];
  territories: Territory[];
  updateProfileAction: (formData: FormData) => Promise<void>;
  saveCriteriaAction: (formData: FormData) => Promise<void>;
  deleteProfileAction: (formData: FormData) => Promise<void>;
};

function buildCriteriaMap(criteria: Criterion[]) {
  const map = new Map<string, Set<string>>();
  for (const c of criteria) {
    const set = map.get(c.criteria_type) || new Set<string>();
    set.add(c.criteria_value);
    map.set(c.criteria_type, set);
  }
  return map;
}

function getNumericValue(
  map: Map<string, Set<string>>,
  key: string,
): string {
  const set = map.get(key);
  if (!set || set.size === 0) return "";
  return [...set][0];
}

function buildSummary(criteriaMap: Map<string, Set<string>>): string {
  const parts: string[] = [];

  const accountTypes = criteriaMap.get("account_type");
  if (accountTypes?.size) {
    const labels = [...accountTypes]
      .map(
        (v) =>
          ICP_ACCOUNT_TYPES.find((t) => t.value === v)?.label ?? v,
      )
      .join(", ");
    parts.push(`Account types: ${labels}`);
  }

  const verticals = criteriaMap.get("vertical");
  if (verticals?.size) {
    const labels = [...verticals]
      .map(
        (v) => ICP_VERTICALS.find((t) => t.value === v)?.label ?? v,
      )
      .join(", ");
    parts.push(`Verticals: ${labels}`);
  }

  const sizeMin = getNumericValue(criteriaMap, "property_size_min");
  const sizeMax = getNumericValue(criteriaMap, "property_size_max");
  if (sizeMin || sizeMax) {
    const range =
      sizeMin && sizeMax
        ? `${Number(sizeMin).toLocaleString()} – ${Number(sizeMax).toLocaleString()} sq ft`
        : sizeMin
          ? `${Number(sizeMin).toLocaleString()}+ sq ft`
          : `up to ${Number(sizeMax).toLocaleString()} sq ft`;
    parts.push(`Property size: ${range}`);
  }

  const ageMin = getNumericValue(criteriaMap, "roof_age_min");
  const ageMax = getNumericValue(criteriaMap, "roof_age_max");
  if (ageMin || ageMax) {
    const range =
      ageMin && ageMax
        ? `${ageMin} – ${ageMax} years`
        : ageMin
          ? `${ageMin}+ years`
          : `up to ${ageMax} years`;
    parts.push(`Roof age: ${range}`);
  }

  const buildingTypes = criteriaMap.get("building_type");
  if (buildingTypes?.size) {
    const labels = [...buildingTypes]
      .map(
        (v) =>
          ICP_BUILDING_TYPES.find((t) => t.value === v)?.label ?? v,
      )
      .join(", ");
    parts.push(`Roof types: ${labels}`);
  }

  const roles = criteriaMap.get("decision_role");
  if (roles?.size) {
    const labels = [...roles]
      .map(
        (v) =>
          ICP_DECISION_ROLES.find((t) => t.value === v)?.label ?? v,
      )
      .join(", ");
    parts.push(`Decision makers: ${labels}`);
  }

  return parts.length > 0
    ? parts.join(". ") + "."
    : "No criteria defined yet.";
}

export default function ICPDetailClient({
  profile,
  criteria,
  territories,
  updateProfileAction,
  saveCriteriaAction,
  deleteProfileAction,
}: Props) {
  const initialMap = buildCriteriaMap(criteria);

  // Multi-select state
  const [accountTypes, setAccountTypes] = useState<Set<string>>(
    initialMap.get("account_type") ?? new Set(),
  );
  const [verticals, setVerticals] = useState<Set<string>>(
    initialMap.get("vertical") ?? new Set(),
  );
  const [buildingTypes, setBuildingTypes] = useState<Set<string>>(
    initialMap.get("building_type") ?? new Set(),
  );
  const [decisionRoles, setDecisionRoles] = useState<Set<string>>(
    initialMap.get("decision_role") ?? new Set(),
  );

  // Numeric state
  const [propertySizeMin, setPropertySizeMin] = useState(
    getNumericValue(initialMap, "property_size_min"),
  );
  const [propertySizeMax, setPropertySizeMax] = useState(
    getNumericValue(initialMap, "property_size_max"),
  );
  const [roofAgeMin, setRoofAgeMin] = useState(
    getNumericValue(initialMap, "roof_age_min"),
  );
  const [roofAgeMax, setRoofAgeMax] = useState(
    getNumericValue(initialMap, "roof_age_max"),
  );

  const criteriaFormRef = useRef<HTMLFormElement>(null);

  function toggleInSet(
    set: Set<string>,
    setter: (s: Set<string>) => void,
    value: string,
  ) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  }

  // Build current criteria map for summary
  const currentMap = new Map<string, Set<string>>();
  if (accountTypes.size) currentMap.set("account_type", accountTypes);
  if (verticals.size) currentMap.set("vertical", verticals);
  if (buildingTypes.size) currentMap.set("building_type", buildingTypes);
  if (decisionRoles.size) currentMap.set("decision_role", decisionRoles);
  if (propertySizeMin)
    currentMap.set("property_size_min", new Set([propertySizeMin]));
  if (propertySizeMax)
    currentMap.set("property_size_max", new Set([propertySizeMax]));
  if (roofAgeMin) currentMap.set("roof_age_min", new Set([roofAgeMin]));
  if (roofAgeMax) currentMap.set("roof_age_max", new Set([roofAgeMax]));

  function buildCriteriaJson(): string {
    const rows: { criteria_type: string; criteria_value: string }[] = [];
    for (const v of accountTypes) rows.push({ criteria_type: "account_type", criteria_value: v });
    for (const v of verticals) rows.push({ criteria_type: "vertical", criteria_value: v });
    for (const v of buildingTypes) rows.push({ criteria_type: "building_type", criteria_value: v });
    for (const v of decisionRoles) rows.push({ criteria_type: "decision_role", criteria_value: v });
    if (propertySizeMin) rows.push({ criteria_type: "property_size_min", criteria_value: propertySizeMin });
    if (propertySizeMax) rows.push({ criteria_type: "property_size_max", criteria_value: propertySizeMax });
    if (roofAgeMin) rows.push({ criteria_type: "roof_age_min", criteria_value: roofAgeMin });
    if (roofAgeMax) rows.push({ criteria_type: "roof_age_max", criteria_value: roofAgeMax });
    return JSON.stringify(rows);
  }

  function handleSaveCriteria() {
    if (!criteriaFormRef.current) return;
    const hidden = criteriaFormRef.current.querySelector(
      'input[name="criteria_json"]',
    ) as HTMLInputElement;
    if (hidden) hidden.value = buildCriteriaJson();
    criteriaFormRef.current.requestSubmit();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {profile.name}
          </h1>
          {profile.description && (
            <p className="mt-1 text-sm text-slate-600">
              {profile.description}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            {profile.active ? (
              <span className="rounded-md bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                Active
              </span>
            ) : (
              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                Inactive
              </span>
            )}
          </div>
        </div>
        <form action={deleteProfileAction}>
          <input type="hidden" name="profile_id" value={profile.id} />
          <button
            type="submit"
            className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
            onClick={(e) => {
              if (
                !confirm(
                  `Delete "${profile.name}"? This cannot be undone.`,
                )
              ) {
                e.preventDefault();
              }
            }}
          >
            Delete Profile
          </button>
        </form>
      </div>

      {/* Profile Settings */}
      <form
        action={updateProfileAction}
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3"
      >
        <h2 className="text-lg font-semibold text-slate-900">
          Profile Settings
        </h2>
        <input type="hidden" name="profile_id" value={profile.id} />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Name</label>
            <input
              name="name"
              required
              defaultValue={profile.name}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">
              Description
            </label>
            <input
              name="description"
              defaultValue={profile.description ?? ""}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">
              Territory
            </label>
            <select
              name="territory_id"
              defaultValue={profile.territory_id ?? ""}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
            >
              <option value="">No territory</option>
              {territories.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">
              Status
            </label>
            <select
              name="active"
              defaultValue={profile.active ? "true" : "false"}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
        </div>

        <button className="h-9 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700">
          Save Settings
        </button>
      </form>

      {/* ICP Summary Preview */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-blue-900">
          ICP Summary
        </h2>
        <p className="mt-1 text-sm text-blue-800">
          {buildSummary(currentMap)}
        </p>
      </div>

      {/* Criteria Editor */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            Targeting Criteria
          </h2>
          <button
            type="button"
            onClick={handleSaveCriteria}
            className="h-9 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
          >
            Save Criteria
          </button>
        </div>

        {/* Hidden form for submission */}
        <form ref={criteriaFormRef} action={saveCriteriaAction} className="hidden">
          <input type="hidden" name="profile_id" value={profile.id} />
          <input type="hidden" name="criteria_json" value="" />
        </form>

        {/* Account Types */}
        <CheckboxGroup
          label="Account Types"
          options={ICP_ACCOUNT_TYPES}
          selected={accountTypes}
          onToggle={(v) => toggleInSet(accountTypes, setAccountTypes, v)}
        />

        {/* Verticals */}
        <CheckboxGroup
          label="Verticals"
          options={ICP_VERTICALS}
          selected={verticals}
          onToggle={(v) => toggleInSet(verticals, setVerticals, v)}
        />

        {/* Building / Roof Types */}
        <CheckboxGroup
          label="Building / Roof Types"
          options={ICP_BUILDING_TYPES}
          selected={buildingTypes}
          onToggle={(v) => toggleInSet(buildingTypes, setBuildingTypes, v)}
        />

        {/* Decision Maker Roles */}
        <CheckboxGroup
          label="Decision Maker Roles"
          options={ICP_DECISION_ROLES}
          selected={decisionRoles}
          onToggle={(v) => toggleInSet(decisionRoles, setDecisionRoles, v)}
        />

        {/* Property Size Range */}
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Property Size (sq ft)
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              placeholder="Min"
              value={propertySizeMin}
              onChange={(e) => setPropertySizeMin(e.target.value)}
              className="h-9 w-32 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
            />
            <span className="text-sm text-slate-400">to</span>
            <input
              type="number"
              min="0"
              placeholder="Max"
              value={propertySizeMax}
              onChange={(e) => setPropertySizeMax(e.target.value)}
              className="h-9 w-32 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
            />
          </div>
        </div>

        {/* Roof Age Range */}
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Roof Age (years)
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              placeholder="Min"
              value={roofAgeMin}
              onChange={(e) => setRoofAgeMin(e.target.value)}
              className="h-9 w-32 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
            />
            <span className="text-sm text-slate-400">to</span>
            <input
              type="number"
              min="0"
              placeholder="Max"
              value={roofAgeMax}
              onChange={(e) => setRoofAgeMax(e.target.value)}
              className="h-9 w-32 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Reusable checkbox group ── */

function CheckboxGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const isSelected = selected.has(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onToggle(opt.value)}
              className={[
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                isSelected
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-400",
              ].join(" ")}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
