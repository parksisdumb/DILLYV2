"use client";

// "Relationships going cold" — the account-level counterpart to Pipeline Health's
// stalled-deal flag. Weighted by ICP priority so a P1 going quiet surfaces fast and
// a P4 going quiet stays out of the way.
//
// Actionable by design: each row's primary action opens the Grow log form
// pre-filled with that account's most recently touched contact. Accounts with no
// touched contact link to the account instead, so no row is a dead end.

import Link from "next/link";
import { PRIORITY_COLORS, PRIORITY_LABELS_SHORT } from "@/lib/scoring/icp-score";
import type { ColdAccount } from "@/lib/cold-accounts";

const MAX_ROWS = 5;

export default function RelationshipsGoingCold({
  accounts,
  onLog,
}: {
  accounts: ColdAccount[];
  /** Opens the log form pre-filled with this account's most-recent contact. */
  onLog: (account: ColdAccount) => void;
}) {
  if (accounts.length === 0) return null;

  const shown = accounts.slice(0, MAX_ROWS);

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">Relationships going cold</h2>
        <span className="text-xs tabular-nums text-slate-600">{accounts.length}</span>
      </div>

      <div className="space-y-2">
        {shown.map((a) => (
          <div
            key={a.accountId}
            className="flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-white p-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${PRIORITY_COLORS[a.priority]}`}
                >
                  {PRIORITY_LABELS_SHORT[a.priority]}
                </span>
                <Link
                  href={`/app/accounts/${a.accountId}`}
                  className="truncate text-sm font-medium text-slate-900 hover:underline"
                >
                  {a.accountName}
                </Link>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {a.neverTouched
                  ? `Never touched · ${a.daysCold} days on file`
                  : `${a.daysCold} days since last touch`}
                {" · "}
                {a.propertyCount} propert{a.propertyCount === 1 ? "y" : "ies"}
                {a.recentContactName ? ` · ${a.recentContactName}` : ""}
              </p>
            </div>

            {a.recentContactId ? (
              <button
                type="button"
                onClick={() => onLog(a)}
                className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                Log
              </button>
            ) : (
              <Link
                href={`/app/accounts/${a.accountId}`}
                className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Open
              </Link>
            )}
          </div>
        ))}
      </div>

      {accounts.length > MAX_ROWS && (
        <Link
          href="/app/accounts"
          className="mt-3 block text-xs font-medium text-blue-700 hover:underline"
        >
          View all {accounts.length}
        </Link>
      )}
    </div>
  );
}
