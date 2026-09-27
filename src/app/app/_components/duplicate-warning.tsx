"use client";

import { useEffect, useRef } from "react";
import type { AddressMatchTone } from "@/lib/address";

/**
 * Non-blocking duplicate warning.
 *
 * The contract, and the reason this component exists: DEDUPE WARNS, NEVER BLOCKS.
 * Every create surface that checks for duplicates renders this panel, and the panel
 * always offers both exits with equal weight — "Use existing" and "Create anyway".
 * `onCreateAnyway` is wired straight to a forced create by the caller, so it cannot
 * degrade into a no-op no matter what the rep edited after the warning appeared.
 */

export type DuplicateWarningMatch = {
  id: string;
  label: string;
  sub: string;
  href: string;
  tone: AddressMatchTone;
};

const COPY: Record<
  AddressMatchTone,
  { heading: string; body: string; shell: string; heading_c: string; body_c: string; row: string }
> = {
  duplicate: {
    heading: "Possible duplicate — this address is already in Dilly.",
    body: "Open the existing property, or create this one anyway if it really is a different building. Nothing is blocked either way.",
    shell: "border-amber-300 bg-amber-50",
    heading_c: "text-amber-900",
    body_c: "text-amber-800",
    row: "border-amber-200",
  },
  similar: {
    heading: "Similar address at this location — is this a different building?",
    body: "Same street, different suite or unit. If it is a separate building or space, create it. If it is the same one, open the existing record.",
    shell: "border-sky-300 bg-sky-50",
    heading_c: "text-sky-900",
    body_c: "text-sky-800",
    row: "border-sky-200",
  },
};

export default function DuplicateWarning({
  tone,
  matches,
  busy,
  onUseExisting,
  onCreateAnyway,
  createLabel = "Create anyway",
}: {
  tone: AddressMatchTone;
  matches: DuplicateWarningMatch[];
  busy?: boolean;
  /** Called with the match the rep chose — the caller navigates. */
  onUseExisting: (match: DuplicateWarningMatch) => void;
  /** MUST create. No re-check, no gate. */
  onCreateAnyway: () => void;
  createLabel?: string;
}) {
  // Pull the panel into view when it appears. On a phone the submit button sits at
  // the bottom of a long form, so an advisory that renders above it would otherwise
  // be off-screen and the rep would be tapping blind.
  const ref = useRef<HTMLDivElement>(null);
  const appeared = matches.length > 0;
  useEffect(() => {
    if (appeared) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [appeared]);

  if (!appeared) return null;
  const c = COPY[tone];
  const action =
    "w-full rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 sm:flex-1";

  return (
    <div ref={ref} role="status" aria-live="polite" className={`rounded-2xl border p-4 ${c.shell}`}>
      <p className={`text-sm font-semibold ${c.heading_c}`}>{c.heading}</p>
      <p className={`mt-1 text-xs ${c.body_c}`}>{c.body}</p>

      <div className="mt-3 space-y-1.5">
        {matches.map((m) => (
          <a
            key={m.id}
            href={m.href}
            target="_blank"
            rel="noreferrer"
            className={`flex items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2.5 hover:bg-slate-50 ${c.row}`}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-slate-900">{m.label}</span>
              <span className="block truncate text-xs text-slate-500">{m.sub}</span>
            </span>
            <span className="shrink-0 text-xs font-medium text-blue-600">Open ↗</span>
          </a>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={busy}
          onClick={() => onUseExisting(matches[0])}
          className={`${action} bg-slate-900 hover:bg-slate-800`}
        >
          Use existing
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCreateAnyway}
          className={`${action} bg-blue-600 hover:bg-blue-700`}
        >
          {busy ? "Creating…" : createLabel}
        </button>
      </div>
    </div>
  );
}
