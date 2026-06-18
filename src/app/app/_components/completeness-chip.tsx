"use client";

import type { MissingField } from "@/lib/completeness";

// Small "Completeness" chip for record detail pages.
// "80% complete · Missing: roof type, square footage" — each missing item is a
// one-tap button (onFix) that jumps the user to the field to fix it.

function toneFor(score: number): { ring: string; text: string; bar: string } {
  if (score >= 80) return { ring: "border-green-200 bg-green-50", text: "text-green-700", bar: "bg-green-500" };
  if (score >= 50) return { ring: "border-amber-200 bg-amber-50", text: "text-amber-700", bar: "bg-amber-500" };
  return { ring: "border-red-200 bg-red-50", text: "text-red-700", bar: "bg-red-600" };
}

export default function CompletenessChip({
  score,
  missing,
  onFix,
}: {
  score: number;
  missing: MissingField[];
  onFix?: (key: string) => void;
}) {
  const tone = toneFor(score);

  return (
    <div className={`rounded-xl border p-3 ${tone.ring}`}>
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/70">
          <div className={`h-1.5 rounded-full ${tone.bar}`} style={{ width: `${score}%` }} />
        </div>
        <span className={`text-sm font-semibold ${tone.text}`}>{score}% complete</span>
      </div>

      {missing.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-600">
          <span className="text-slate-500">Missing:</span>
          {missing.map((m, i) =>
            onFix ? (
              <button
                key={m.key}
                type="button"
                onClick={() => onFix(m.key)}
                className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 font-medium text-slate-700 hover:border-blue-400 hover:text-blue-700"
                title={`Fix ${m.label}`}
              >
                {m.label}
              </button>
            ) : (
              <span key={m.key} className="font-medium text-slate-700">
                {m.label}
                {i < missing.length - 1 ? "," : ""}
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}
