"use client";

import { US_STATES } from "@/lib/constants/us-states";

type Territory = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
};

type Region = {
  id: string;
  region_type: string;
  region_value: string;
  state: string;
};

type Assignment = {
  id: string;
  user_id: string;
  role: string;
  active: boolean;
  fullName: string;
};

type OrgUser = {
  user_id: string;
  fullName: string;
};

type Props = {
  territory: Territory;
  regions: Region[];
  assignments: Assignment[];
  orgUsers: OrgUser[];
  addRegionAction: (formData: FormData) => Promise<void>;
  removeRegionAction: (formData: FormData) => Promise<void>;
  assignRepAction: (formData: FormData) => Promise<void>;
  unassignRepAction: (formData: FormData) => Promise<void>;
};

function regionTypeLabel(type: string) {
  switch (type) {
    case "zip":
      return "Zip";
    case "city":
      return "City";
    case "county":
      return "County";
    default:
      return type;
  }
}

export default function TerritoryDetailClient({
  territory,
  regions,
  assignments,
  orgUsers,
  addRegionAction,
  removeRegionAction,
  assignRepAction,
  unassignRepAction,
}: Props) {
  const assignedUserIds = new Set(assignments.map((a) => a.user_id));
  const availableUsers = orgUsers.filter((u) => !assignedUserIds.has(u.user_id));

  // Group regions by state
  const regionsByState = new Map<string, Region[]>();
  for (const r of regions) {
    const list = regionsByState.get(r.state) || [];
    list.push(r);
    regionsByState.set(r.state, list);
  }
  const sortedStates = [...regionsByState.keys()].sort();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {territory.name}
        </h1>
        {territory.description && (
          <p className="mt-1 text-sm text-slate-600">{territory.description}</p>
        )}
        <div className="mt-2 flex items-center gap-2">
          {territory.active ? (
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

      {/* Regions */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">
          Regions ({regions.length})
        </h2>

        <form
          action={addRegionAction}
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
        >
          <input type="hidden" name="territory_id" value={territory.id} />

          <div className="space-y-1 sm:w-32">
            <label className="text-xs font-medium text-slate-600">Type</label>
            <select
              name="region_type"
              defaultValue="zip"
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
            >
              <option value="zip">Zip Code</option>
              <option value="city">City</option>
              <option value="county">County</option>
            </select>
          </div>

          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-slate-600">Value</label>
            <input
              name="region_value"
              required
              placeholder="e.g. 75201 or Dallas"
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
            />
          </div>

          <div className="space-y-1 sm:w-40">
            <label className="text-xs font-medium text-slate-600">State</label>
            <select
              name="state"
              required
              defaultValue=""
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
            >
              <option value="" disabled>
                Select state
              </option>
              {US_STATES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <button className="h-9 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700">
            Add
          </button>
        </form>

        {regions.length === 0 ? (
          <p className="text-sm text-slate-500">
            No regions added yet. Add zip codes, cities, or counties above.
          </p>
        ) : (
          <div className="space-y-3">
            {sortedStates.map((state) => (
              <div key={state}>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-400 mb-1">
                  {US_STATES.find((s) => s.value === state)?.label ?? state}
                </div>
                <div className="space-y-1">
                  {regionsByState.get(state)!.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                    >
                      <div className="text-sm text-slate-900">
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-600 mr-2">
                          {regionTypeLabel(r.region_type)}
                        </span>
                        {r.region_value}
                      </div>
                      <form action={removeRegionAction}>
                        <input type="hidden" name="region_id" value={r.id} />
                        <button
                          type="submit"
                          className="text-xs text-red-500 hover:text-red-700"
                          onClick={(e) => {
                            if (
                              !confirm(
                                `Remove ${r.region_value} from this territory?`,
                              )
                            ) {
                              e.preventDefault();
                            }
                          }}
                        >
                          Remove
                        </button>
                      </form>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assigned Reps */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">
          Assigned Reps ({assignments.length})
        </h2>

        {availableUsers.length > 0 && (
          <form
            action={assignRepAction}
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
          >
            <input type="hidden" name="territory_id" value={territory.id} />

            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-slate-600">Rep</label>
              <select
                name="user_id"
                required
                defaultValue=""
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
              >
                <option value="" disabled>
                  Select a rep
                </option>
                {availableUsers.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.fullName || u.user_id}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1 sm:w-36">
              <label className="text-xs font-medium text-slate-600">Role</label>
              <select
                name="role"
                defaultValue="primary"
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
              >
                <option value="primary">Primary</option>
                <option value="secondary">Secondary</option>
              </select>
            </div>

            <button className="h-9 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700">
              Assign
            </button>
          </form>
        )}

        {assignments.length === 0 ? (
          <p className="text-sm text-slate-500">
            No reps assigned yet. Assign reps above.
          </p>
        ) : (
          <div className="space-y-1">
            {assignments.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">
                    {a.fullName}
                  </span>
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium capitalize text-slate-600">
                    {a.role}
                  </span>
                </div>
                <form action={unassignRepAction}>
                  <input type="hidden" name="assignment_id" value={a.id} />
                  <button
                    type="submit"
                    className="text-xs text-red-500 hover:text-red-700"
                    onClick={(e) => {
                      if (
                        !confirm(`Remove ${a.fullName} from this territory?`)
                      ) {
                        e.preventDefault();
                      }
                    }}
                  >
                    Unassign
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
