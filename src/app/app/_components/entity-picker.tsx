"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { BUILDING_TYPE_LABELS } from "@/app/app/properties/properties-client";

/**
 * Shared searchable entity picker.
 *
 * Replaces raw `<select>` dropdowns over properties / contacts / accounts, which
 * become unusable once an org has hundreds of records (e.g. the New Account form's
 * "Link Property" select rendering ~300 options). Debounced server-side search by
 * name OR address, name bold + secondary line grey — the same pattern that was
 * previously hand-rolled only in the contact-detail Link Property panel.
 *
 * Controlled by `value` (selected id, "" when unset). On pick it calls `onChange`
 * with the full row so callers can update their own local display, and collapses
 * to a compact "selected" chip with a Change / Clear affordance.
 */

export type EntityKind = "property" | "contact" | "account";

export type PickerRow = {
  id: string;
  primary: string;
  secondary: string | null;
  /** Raw selected fields, so callers can read name/address/account_id/etc. */
  raw: Record<string, unknown>;
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  owner: "Owner",
  commercial_property_management: "Property Management",
  facilities_management: "Facilities Management",
  asset_management: "Asset Management",
  general_contractor: "General Contractor",
  developer: "Developer",
  broker: "Broker",
  consultant: "Consultant",
  vendor: "Vendor",
  other: "Other",
};

function sanitizeSearch(q: string) {
  return q.replace(/[,()%]/g, "").trim();
}

type Config = {
  columns: string;
  orderBy: { col: string; opts?: { ascending?: boolean; nullsFirst?: boolean } }[];
  searchColumns: string[];
  /** Column used when the caller scopes results to an account. */
  accountColumn: string;
  toRow: (r: Record<string, unknown>) => PickerRow;
};

const CONFIG: Record<EntityKind, Config> = {
  property: {
    columns: "id,name,address_line1,city,state,postal_code,building_type,primary_account_id",
    accountColumn: "primary_account_id",
    orderBy: [
      { col: "name", opts: { ascending: true, nullsFirst: false } },
      { col: "address_line1", opts: { ascending: true } },
    ],
    searchColumns: ["name", "address_line1", "city"],
    toRow: (r) => {
      const name = (r.name as string | null) ?? null;
      const addr = (r.address_line1 as string) ?? "";
      const cityState = [r.city as string | null, r.state as string | null]
        .filter(Boolean)
        .join(", ");
      const bt = r.building_type as string | null;
      const btLabel = bt ? (BUILDING_TYPE_LABELS[bt] ?? bt) : null;
      const secondary = name
        ? [addr, cityState].filter(Boolean).join(" · ")
        : cityState || null;
      return {
        id: r.id as string,
        primary: name || addr || "Unnamed property",
        secondary: btLabel ? [secondary, btLabel].filter(Boolean).join(" · ") : secondary,
        raw: r,
      };
    },
  },
  contact: {
    columns: "id,full_name,title,email,account_id",
    accountColumn: "account_id",
    orderBy: [{ col: "full_name", opts: { ascending: true } }],
    searchColumns: ["full_name", "title", "email"],
    toRow: (r) => ({
      id: r.id as string,
      primary: (r.full_name as string | null) || "Unnamed contact",
      secondary:
        [r.title as string | null, r.email as string | null].filter(Boolean).join(" · ") ||
        null,
      raw: r,
    }),
  },
  account: {
    columns: "id,name,account_type",
    accountColumn: "id",
    orderBy: [{ col: "name", opts: { ascending: true } }],
    searchColumns: ["name"],
    toRow: (r) => {
      const at = r.account_type as string | null;
      return {
        id: r.id as string,
        primary: (r.name as string | null) || "Unnamed account",
        secondary: at ? (ACCOUNT_TYPE_LABELS[at] ?? at) : null,
        raw: r,
      };
    },
  },
};

export default function EntityPicker({
  kind,
  value,
  onChange,
  placeholder,
  accountId,
  excludeIds,
  autoFocus,
  allowClear = true,
  initialSelected,
  disabled,
  className,
}: {
  kind: EntityKind;
  value: string;
  onChange: (row: PickerRow | null) => void;
  placeholder?: string;
  /** Optional filter — restrict contacts/properties to a given account. */
  accountId?: string | null;
  /** Ids to omit from results (e.g. records already linked). */
  excludeIds?: string[];
  autoFocus?: boolean;
  allowClear?: boolean;
  /** Show the current selection's labels without a round-trip when value is pre-set. */
  initialSelected?: { id: string; primary: string; secondary?: string | null } | null;
  disabled?: boolean;
  className?: string;
}) {
  const supabase = createBrowserSupabase();
  const cfg = CONFIG[kind];

  const [selected, setSelected] = useState<PickerRow | null>(
    initialSelected
      ? { id: initialSelected.id, primary: initialSelected.primary, secondary: initialSelected.secondary ?? null, raw: {} }
      : null,
  );
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PickerRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep the collapsed chip in sync if the parent clears/changes value externally.
  useEffect(() => {
    if (!value) {
      setSelected(null);
    } else if (initialSelected && initialSelected.id === value && !selected) {
      setSelected({
        id: initialSelected.id,
        primary: initialSelected.primary,
        secondary: initialSelected.secondary ?? null,
        raw: {},
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Debounced search while the dropdown is open.
  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const q = sanitizeSearch(search);
      setSearching(true);
      try {
        let query = supabase.from(pluralTable(kind)).select(cfg.columns).is("deleted_at", null);
        if (accountId) query = query.eq(cfg.accountColumn, accountId);
        for (const o of cfg.orderBy) query = query.order(o.col, o.opts);
        query = query.limit(20);
        if (q) {
          const ors = cfg.searchColumns.map((c) => `${c}.ilike.%${q}%`).join(",");
          query = query.or(ors);
        }
        const { data, error: qErr } = await query;
        if (qErr) {
          setError(qErr.message);
          return;
        }
        const exclude = new Set(excludeIds ?? []);
        const rows = (data ?? []) as unknown as Record<string, unknown>[];
        setResults(rows.map((r) => cfg.toRow(r)).filter((r) => !exclude.has(r.id)));
        setError(null);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, open, accountId, kind]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function pick(row: PickerRow) {
    setSelected(row);
    setOpen(false);
    setSearch("");
    setResults([]);
    onChange(row);
  }

  function clear() {
    setSelected(null);
    onChange(null);
  }

  const noun = kind === "property" ? "property" : kind === "contact" ? "contact" : "account";

  // Collapsed state: a selection exists and the picker is closed.
  if (selected && value && !open) {
    return (
      <div ref={containerRef} className={className}>
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900">{selected.primary}</p>
            {selected.secondary && (
              <p className="truncate text-xs text-slate-500">{selected.secondary}</p>
            )}
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={() => {
                setOpen(true);
                setSearch("");
              }}
              className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
            >
              Change
            </button>
          )}
          {!disabled && allowClear && (
            <button
              type="button"
              aria-label={`Clear ${noun}`}
              onClick={clear}
              className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.28 3.22a.75.75 0 00-1.06 1.06L8.94 10l-5.72 5.72a.75.75 0 101.06 1.06L10 11.06l5.72 5.72a.75.75 0 101.06-1.06L11.06 10l5.72-5.72a.75.75 0 00-1.06-1.06L10 8.94 4.28 3.22z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <input
        type="text"
        autoFocus={autoFocus}
        disabled={disabled}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? `Search ${noun} by name${kind === "property" ? " or address" : ""}…`}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none disabled:bg-slate-50"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {error && <p className="px-3 py-2 text-xs text-red-600">{error}</p>}
          <div className="max-h-72 overflow-y-auto">
            {searching && results.length === 0 ? (
              <p className="px-3 py-3 text-sm text-slate-500">Searching…</p>
            ) : results.length === 0 ? (
              <p className="px-3 py-3 text-sm text-slate-500">
                {search ? `No ${noun}s match.` : `Start typing to search ${noun}s.`}
              </p>
            ) : (
              results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => pick(r)}
                  className={`flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2.5 text-left last:border-b-0 hover:bg-slate-50 ${
                    r.id === value ? "bg-blue-50" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{r.primary}</p>
                    {r.secondary && (
                      <p className="truncate text-xs text-slate-500">{r.secondary}</p>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function pluralTable(kind: EntityKind): "properties" | "contacts" | "accounts" {
  if (kind === "property") return "properties";
  if (kind === "contact") return "contacts";
  return "accounts";
}
