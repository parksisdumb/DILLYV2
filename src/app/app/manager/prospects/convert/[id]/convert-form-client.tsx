"use client";

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { ProspectForConvert } from "./page";

type TouchpointTypeOption = { id: string; key: string; label: string };
type OutcomeOption = { id: string; key: string; label: string };

type Props = {
  prospect: ProspectForConvert;
  touchpointTypes: TouchpointTypeOption[];
  outcomes: OutcomeOption[];
  convertAction: (formData: FormData) => Promise<void>;
};

const ACCOUNT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "commercial_property_management", label: "Property Mgmt" },
  { value: "facilities_management", label: "Facilities" },
  { value: "asset_management", label: "Asset Mgmt" },
  { value: "general_contractor", label: "GC" },
  { value: "developer", label: "Developer" },
  { value: "broker", label: "Broker" },
  { value: "consultant", label: "Consultant" },
  { value: "vendor", label: "Vendor" },
  { value: "other", label: "Other" },
];

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const labelCls = "block text-xs font-medium text-slate-600 mb-1";
const sectionCls = "rounded-2xl border border-slate-200 bg-white p-4 space-y-3";

export default function ConvertFormClient({
  prospect,
  touchpointTypes,
  outcomes,
  convertAction,
}: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const searchParams = useSearchParams();
  const errorMsg = searchParams.get("error");

  const hasContact = !!(prospect.email || prospect.phone || prospect.contact_first_name || prospect.contact_last_name);
  const hasAddress = !!(prospect.address_line1 && prospect.city && prospect.state && prospect.postal_code);

  const [createContact, setCreateContact] = useState(hasContact);
  const [createProperty, setCreateProperty] = useState(hasAddress);
  const [logTouchpoint, setLogTouchpoint] = useState(false);
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [selectedOutcomeId, setSelectedOutcomeId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    formRef.current?.requestSubmit();
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/app/manager/prospects"
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-500 hover:bg-slate-50"
        >
          Back
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">Convert Prospect</h1>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      <form ref={formRef} action={convertAction}>
        <input type="hidden" name="prospect_id" value={prospect.id} />
        <input type="hidden" name="touchpoint_type_id" value={selectedTypeId} />
        <input type="hidden" name="touchpoint_outcome_id" value={selectedOutcomeId} />

        <div className="space-y-4">
          {/* Section 1: Account */}
          <div className={sectionCls}>
            <div className="text-sm font-semibold text-slate-900">Account</div>

            <div>
              <label className={labelCls}>Company Name *</label>
              <input
                type="text"
                name="account_name"
                defaultValue={prospect.company_name}
                required
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>Account Type</label>
              <select
                name="account_type"
                defaultValue={prospect.account_type ?? ""}
                className={inputCls}
              >
                <option value="">Select type...</option>
                {ACCOUNT_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Website</label>
                <input
                  type="text"
                  name="account_website"
                  defaultValue={prospect.website ?? ""}
                  placeholder="example.com"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Phone</label>
                <input
                  type="text"
                  name="account_phone"
                  defaultValue={prospect.phone ?? ""}
                  placeholder="(555) 123-4567"
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Notes</label>
              <textarea
                name="account_notes"
                defaultValue={prospect.notes ?? ""}
                rows={2}
                className={inputCls}
              />
            </div>
          </div>

          {/* Section 2: Contact */}
          <div className={sectionCls}>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="create_contact"
                checked={createContact}
                onChange={(e) => setCreateContact(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-semibold text-slate-900">Create Primary Contact</span>
            </label>

            {createContact && (
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>Full Name</label>
                  <input
                    type="text"
                    name="contact_full_name"
                    defaultValue={[prospect.contact_first_name, prospect.contact_last_name].filter(Boolean).join(" ")}
                    placeholder="Jane Smith"
                    className={inputCls}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>First Name</label>
                    <input type="text" name="contact_first_name" defaultValue={prospect.contact_first_name ?? ""} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Last Name</label>
                    <input type="text" name="contact_last_name" defaultValue={prospect.contact_last_name ?? ""} className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Title</label>
                  <input type="text" name="contact_title" defaultValue={prospect.contact_title ?? ""} placeholder="VP of Operations" className={inputCls} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Email</label>
                    <input
                      type="email"
                      name="contact_email"
                      defaultValue={prospect.email ?? ""}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Phone</label>
                    <input
                      type="text"
                      name="contact_phone"
                      defaultValue={prospect.phone ?? ""}
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Property */}
          <div className={sectionCls}>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="create_property"
                checked={createProperty}
                onChange={(e) => setCreateProperty(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-semibold text-slate-900">Create Property</span>
            </label>

            {createProperty && (
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>Property Name *</label>
                  <input
                    type="text"
                    name="property_name"
                    required={createProperty}
                    className={inputCls}
                    placeholder="e.g. Prologis Memphis Industrial Park"
                  />
                </div>
                <div>
                  <label className={labelCls}>Address *</label>
                  <input
                    type="text"
                    name="property_address"
                    defaultValue={prospect.address_line1 ?? ""}
                    required={createProperty}
                    className={inputCls}
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls}>City *</label>
                    <input
                      type="text"
                      name="property_city"
                      defaultValue={prospect.city ?? ""}
                      required={createProperty}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>State *</label>
                    <input
                      type="text"
                      name="property_state"
                      defaultValue={prospect.state ?? ""}
                      required={createProperty}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Zip *</label>
                    <input
                      type="text"
                      name="property_postal_code"
                      defaultValue={prospect.postal_code ?? ""}
                      required={createProperty}
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 4: First Touchpoint */}
          <div className={sectionCls}>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="log_touchpoint"
                checked={logTouchpoint}
                onChange={(e) => setLogTouchpoint(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-semibold text-slate-900">Log Initial Outreach</span>
            </label>

            {logTouchpoint && (
              <div className="space-y-3">
                {!createContact && (
                  <p className="text-xs text-amber-600">
                    A contact is required to log outreach. Enable &quot;Create Primary Contact&quot; above.
                  </p>
                )}

                <div>
                  <label className={labelCls}>Type</label>
                  <div className="flex flex-wrap gap-2">
                    {touchpointTypes.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedTypeId(t.id)}
                        className={[
                          "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                          selectedTypeId === t.id
                            ? "border-blue-600 bg-blue-50 text-blue-700"
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                        ].join(" ")}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Outcome</label>
                  <div className="flex flex-wrap gap-2">
                    {outcomes.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => setSelectedOutcomeId(o.id)}
                        className={[
                          "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                          selectedOutcomeId === o.id
                            ? "border-blue-600 bg-blue-50 text-blue-700"
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                        ].join(" ")}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Notes</label>
                  <textarea
                    name="touchpoint_notes"
                    rows={2}
                    placeholder="Initial outreach notes..."
                    className={inputCls}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Submit */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "Converting..." : "Convert to Account"}
          </button>
        </div>
      </form>
    </div>
  );
}
