"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { REASON_CODE_LABELS, DISMISS_REASONS } from "@/lib/constants/outreach-reasons";

// ── Types ───────────────────────────────────────────────────────────────────

export type SuggestionRow = {
  id: string;
  prospect_id: string;
  rank_score: number;
  reason_codes: string[];
  company_name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  account_type: string | null;
  notes: string | null;
};

type Props = {
  suggestions: SuggestionRow[];
  onAccept: (suggestion: SuggestionRow) => void;
  onDismiss: (suggestionId: string) => void;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  owner: "Owner",
  commercial_property_management: "Property Mgmt",
  facilities_management: "Facilities",
  asset_management: "Asset Mgmt",
  general_contractor: "GC",
  developer: "Developer",
  broker: "Broker",
  consultant: "Consultant",
  vendor: "Vendor",
  other: "Other",
};

const TYPE_COLORS: Record<string, string> = {
  owner: "bg-purple-100 text-purple-700",
  commercial_property_management: "bg-blue-100 text-blue-700",
  facilities_management: "bg-cyan-100 text-cyan-700",
  asset_management: "bg-indigo-100 text-indigo-700",
  general_contractor: "bg-orange-100 text-orange-700",
  developer: "bg-green-100 text-green-700",
  broker: "bg-yellow-100 text-yellow-700",
  consultant: "bg-rose-100 text-rose-700",
  vendor: "bg-slate-100 text-slate-700",
  other: "bg-slate-100 text-slate-600",
};

function location(s: SuggestionRow): string {
  const parts: string[] = [];
  if (s.city) parts.push(s.city);
  if (s.state) parts.push(s.state);
  return parts.join(", ");
}

/** reason_codes comes from jsonb — may be a real array, a JSON string, or null */
function parseReasonCodes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) return parsed; } catch { /* ignore */ }
  }
  return [];
}

// ── Component ───────────────────────────────────────────────────────────────

export default function SuggestedOutreach({ suggestions, onAccept, onDismiss }: Props) {
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissBusy, setDismissBusy] = useState(false);

  if (suggestions.length === 0) return null;

  async function handleDismiss(id: string, reason: string) {
    setDismissBusy(true);
    await supabase
      .from("suggested_outreach")
      .update({ status: "dismissed", reason_codes: [reason] })
      .eq("id", id);
    setDismissBusy(false);
    setDismissingId(null);
    onDismiss(id);
  }

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Suggested Outreach
      </div>

      {suggestions.map((s) => (
        <div
          key={s.id}
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          {/* Header: company + type badge */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">
              {s.company_name}
            </span>
            {s.account_type && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  TYPE_COLORS[s.account_type] ?? "bg-slate-100 text-slate-600"
                }`}
              >
                {TYPE_LABELS[s.account_type] ?? s.account_type}
              </span>
            )}
          </div>

          {/* Location + contact info */}
          <div className="mt-1 text-xs text-slate-500">
            {location(s) && <span>{location(s)}</span>}
            {s.email && <span>{location(s) ? " · " : ""}{s.email}</span>}
            {s.phone && <span> · {s.phone}</span>}
          </div>

          {/* Reason tags */}
          {parseReasonCodes(s.reason_codes).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {parseReasonCodes(s.reason_codes).map((code) => (
                <span
                  key={code}
                  className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
                >
                  {REASON_CODE_LABELS[code] ?? code}
                </span>
              ))}
            </div>
          )}

          {/* Actions */}
          {dismissingId === s.id ? (
            <div className="mt-3 space-y-2">
              <div className="text-xs font-medium text-slate-600">Why dismiss?</div>
              <div className="flex flex-wrap gap-2">
                {DISMISS_REASONS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    disabled={dismissBusy}
                    onClick={() => void handleDismiss(s.id, r.value)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {r.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setDismissingId(null)}
                  className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-slate-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => onAccept(s)}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Start Outreach
              </button>
              <Link
                href={`/app/manager/prospects/convert/${s.prospect_id}`}
                className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
              >
                Convert
              </Link>
              <button
                type="button"
                onClick={() => setDismissingId(s.id)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
