"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createBrowserSupabase } from "@/lib/supabase/browser";

// ── Types ───────────────────────────────────────────────────────────────────

export type ActivityRep = { userId: string; name: string };

type LookupRow = { id: string; key: string; name: string; sort_order: number; is_outreach?: boolean };

type TouchpointRow = {
  id: string;
  rep_user_id: string;
  touchpoint_type_id: string;
  outcome_id: string | null;
  account_id: string | null;
  contact_id: string | null;
  property_id: string | null;
  happened_at: string;
  notes: string | null;
  direction: string | null;
};

type DatePreset = "week" | "month" | "30d" | "custom";

// Outcome-key buckets for the summary cards (covers both current + legacy keys).
const CONNECT_KEYS = new Set(["connected_conversation", "connected", "met_in_person"]);
const INSPECTION_KEYS = new Set(["inspection_scheduled", "inspection_set"]);
const PROPOSAL_KEYS = new Set(["bid_submitted", "proposal_sent"]);

const FEED_PAGE = 100; // rows revealed per "load more"
const FETCH_CAP = 500; // safety cap on a single filtered fetch

// ── Helpers ─────────────────────────────────────────────────────────────────

function rangeFor(preset: DatePreset, customStart: string, customEnd: string): { start: string; end: string } {
  const now = new Date();
  const endNow = now.toISOString();
  if (preset === "week") {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dow = now.getUTCDay();
    d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1)); // Monday start
    return { start: d.toISOString(), end: endNow };
  }
  if (preset === "month") {
    return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(), end: endNow };
  }
  if (preset === "30d") {
    return { start: new Date(now.getTime() - 30 * 86400000).toISOString(), end: endNow };
  }
  // custom
  const start = customStart ? new Date(`${customStart}T00:00:00Z`).toISOString() : new Date(0).toISOString();
  const end = customEnd ? new Date(`${customEnd}T23:59:59Z`).toISOString() : endNow;
  return { start, end };
}

function relativeTime(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  const steps = [60, 60, 24, 30, 12]; // sec→min→hour→day→month→year
  const names = ["sec", "min", "hour", "day", "month", "year"];
  let val = sec;
  let i = 0;
  while (i < steps.length && val >= steps[i]) {
    val = Math.floor(val / steps[i]);
    i++;
  }
  return `${val} ${names[i]}${val === 1 ? "" : "s"} ago`;
}

function exactDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function uniq(ids: (string | null)[]): string[] {
  return Array.from(new Set(ids.filter((v): v is string => Boolean(v))));
}

// Collapse global + org-specific lookup rows that share a key into one option,
// keeping every id for that key so a key filter matches touchpoints either way.
function groupByKey(rows: LookupRow[]): { key: string; name: string; ids: string[]; sort_order: number }[] {
  const map = new Map<string, { key: string; name: string; ids: string[]; sort_order: number }>();
  for (const r of rows) {
    const e = map.get(r.key);
    if (e) e.ids.push(r.id);
    else map.set(r.key, { key: r.key, name: r.name, ids: [r.id], sort_order: r.sort_order });
  }
  return Array.from(map.values()).sort((a, b) => a.sort_order - b.sort_order);
}

// ── Component ───────────────────────────────────────────────────────────────

export default function ActivityView({ reps, orgId }: { reps: ActivityRep[]; orgId: string }) {
  const supabase = useMemo(() => createBrowserSupabase(), []);
  void orgId; // RLS scopes all queries to the manager's org automatically.

  // Filters
  const [repFilter, setRepFilter] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("week");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [typeKey, setTypeKey] = useState("");
  const [outcomeKey, setOutcomeKey] = useState("");

  // Lookups (fetched once)
  const [types, setTypes] = useState<LookupRow[]>([]);
  const [outcomes, setOutcomes] = useState<LookupRow[]>([]);
  const [lookupsReady, setLookupsReady] = useState(false);

  // Data
  const [rows, setRows] = useState<TouchpointRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [accountsById, setAccountsById] = useState<Map<string, string | null>>(new Map());
  const [contactsById, setContactsById] = useState<Map<string, string | null>>(new Map());
  const [propertiesById, setPropertiesById] = useState<Map<string, string>>(new Map());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(FEED_PAGE);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const repName = useMemo(() => new Map(reps.map((r) => [r.userId, r.name])), [reps]);
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const outcomeById = useMemo(() => new Map(outcomes.map((o) => [o.id, o])), [outcomes]);

  // Outreach types for the Activity-type dropdown; all outcomes for the Outcome dropdown.
  const typeOptions = useMemo(() => groupByKey(types.filter((t) => t.is_outreach)), [types]);
  const outcomeOptions = useMemo(() => groupByKey(outcomes), [outcomes]);
  const typeIdsByKey = useMemo(() => new Map(groupByKey(types).map((g) => [g.key, g.ids])), [types]);
  const outcomeIdsByKey = useMemo(() => new Map(outcomeOptions.map((g) => [g.key, g.ids])), [outcomeOptions]);

  // 1) Lookups, once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [tRes, oRes] = await Promise.all([
        supabase.from("touchpoint_types").select("id,key,name,sort_order,is_outreach").order("sort_order"),
        supabase.from("touchpoint_outcomes").select("id,key,name,sort_order").order("sort_order"),
      ]);
      if (cancelled) return;
      setTypes((tRes.data ?? []) as LookupRow[]);
      setOutcomes((oRes.data ?? []) as LookupRow[]);
      setLookupsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // 2) Touchpoints + batch name joins, whenever filters change.
  const fetchActivity = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { start, end } = rangeFor(datePreset, customStart, customEnd);

      let q = supabase
        .from("touchpoints")
        .select(
          "id,rep_user_id,touchpoint_type_id,outcome_id,account_id,contact_id,property_id,happened_at,notes,direction",
          { count: "exact" },
        )
        .gte("happened_at", start)
        .lte("happened_at", end)
        .order("happened_at", { ascending: false })
        .limit(FETCH_CAP);

      // Stackable filters — each .eq/.in ANDs with the others.
      if (repFilter) q = q.eq("rep_user_id", repFilter);
      if (typeKey) q = q.in("touchpoint_type_id", typeIdsByKey.get(typeKey) ?? ["00000000-0000-0000-0000-000000000000"]);
      if (outcomeKey) q = q.in("outcome_id", outcomeIdsByKey.get(outcomeKey) ?? ["00000000-0000-0000-0000-000000000000"]);

      const { data, count, error: qErr } = await q;
      if (qErr) throw new Error(qErr.message);

      const tps = (data ?? []) as TouchpointRow[];
      setRows(tps);
      setTotalCount(count ?? tps.length);
      setVisibleCount(FEED_PAGE);

      // Batch joins — 3 queries via .in(), never per-row.
      const [accRes, conRes, propRes] = await Promise.all([
        uniq(tps.map((t) => t.account_id)).length
          ? supabase.from("accounts").select("id,name").in("id", uniq(tps.map((t) => t.account_id)))
          : Promise.resolve({ data: [] }),
        uniq(tps.map((t) => t.contact_id)).length
          ? supabase.from("contacts").select("id,full_name").in("id", uniq(tps.map((t) => t.contact_id)))
          : Promise.resolve({ data: [] }),
        uniq(tps.map((t) => t.property_id)).length
          ? supabase.from("properties").select("id,name,address_line1").in("id", uniq(tps.map((t) => t.property_id)))
          : Promise.resolve({ data: [] }),
      ]);

      setAccountsById(new Map(((accRes.data ?? []) as { id: string; name: string | null }[]).map((a) => [a.id, a.name])));
      setContactsById(new Map(((conRes.data ?? []) as { id: string; full_name: string | null }[]).map((c) => [c.id, c.full_name])));
      setPropertiesById(
        new Map(
          ((propRes.data ?? []) as { id: string; name: string | null; address_line1: string }[]).map((p) => [
            p.id,
            p.name?.trim() || p.address_line1,
          ]),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase, datePreset, customStart, customEnd, repFilter, typeKey, outcomeKey, typeIdsByKey, outcomeIdsByKey]);

  useEffect(() => {
    if (!lookupsReady) return;
    void fetchActivity();
  }, [lookupsReady, fetchActivity]);

  // Summary — Total from the exact count; breakdowns from the fetched set.
  const summary = useMemo(() => {
    let connects = 0;
    let inspections = 0;
    let proposals = 0;
    const accounts = new Set<string>();
    for (const r of rows) {
      const key = r.outcome_id ? outcomeById.get(r.outcome_id)?.key : undefined;
      if (key && CONNECT_KEYS.has(key)) connects++;
      if (key && INSPECTION_KEYS.has(key)) inspections++;
      if (key && PROPOSAL_KEYS.has(key)) proposals++;
      if (r.account_id) accounts.add(r.account_id);
    }
    return { total: totalCount, connects, inspections, proposals, accounts: accounts.size };
  }, [rows, totalCount, outcomeById]);

  const capped = totalCount > rows.length;
  const visibleRows = rows.slice(0, visibleCount);

  function toggleNote(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectCls =
    "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none";

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select className={selectCls} value={repFilter} onChange={(e) => setRepFilter(e.target.value)}>
          <option value="">All reps</option>
          {reps.map((r) => (
            <option key={r.userId} value={r.userId}>
              {r.name}
            </option>
          ))}
        </select>

        <select className={selectCls} value={datePreset} onChange={(e) => setDatePreset(e.target.value as DatePreset)}>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
          <option value="30d">Last 30 Days</option>
          <option value="custom">Custom…</option>
        </select>

        {datePreset === "custom" && (
          <>
            <input type="date" className={selectCls} value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            <span className="self-center text-sm text-slate-400">to</span>
            <input type="date" className={selectCls} value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
          </>
        )}

        <select className={selectCls} value={typeKey} onChange={(e) => setTypeKey(e.target.value)}>
          <option value="">All types</option>
          {typeOptions.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
            </option>
          ))}
        </select>

        <select className={selectCls} value={outcomeKey} onChange={(e) => setOutcomeKey(e.target.value)}>
          <option value="">All outcomes</option>
          {outcomeOptions.map((o) => (
            <option key={o.key} value={o.key}>
              {o.name}
            </option>
          ))}
        </select>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: "Touchpoints", value: summary.total },
          { label: "Connects", value: summary.connects },
          { label: "Inspections", value: summary.inspections },
          { label: "Proposals", value: summary.proposals },
          { label: "Accounts touched", value: summary.accounts },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-2xl font-bold text-slate-900 tabular-nums">{c.value.toLocaleString()}</div>
            <div className="text-xs text-slate-500">{c.label}</div>
          </div>
        ))}
      </div>

      {capped && (
        <p className="text-xs text-amber-600">
          Showing the most recent {rows.length} of {totalCount.toLocaleString()} matching touchpoints — narrow the
          filters for exact Connect/Inspection/Proposal breakdowns.
        </p>
      )}

      {/* Feed */}
      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : loading ? (
        <p className="text-sm text-slate-500">Loading activity…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No activity matches these filters.
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {visibleRows.map((r) => {
              const type = typeById.get(r.touchpoint_type_id);
              const outcome = r.outcome_id ? outcomeById.get(r.outcome_id) : undefined;
              const accountName = r.account_id ? accountsById.get(r.account_id) ?? null : null;
              const contactName = r.contact_id ? contactsById.get(r.contact_id) ?? null : null;
              const propertyName = r.property_id ? propertiesById.get(r.property_id) ?? null : null;
              const isOpen = expanded.has(r.id);
              const longNote = (r.notes?.length ?? 0) > 140;
              return (
                <div key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="font-semibold text-slate-900">{repName.get(r.rep_user_id) ?? "Unknown rep"}</span>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-700">{type?.name ?? "Activity"}</span>
                    {r.direction === "inbound" && (
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">inbound</span>
                    )}
                    {outcome && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                          {outcome.name}
                        </span>
                      </>
                    )}
                    <span className="ml-auto text-xs text-slate-400" title={exactDate(r.happened_at)}>
                      {relativeTime(r.happened_at)}
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                    {accountName && r.account_id ? (
                      <Link href={`/app/accounts/${r.account_id}`} className="text-blue-600 hover:underline">
                        {accountName}
                      </Link>
                    ) : (
                      <span className="text-slate-400">No account</span>
                    )}
                    {contactName && r.contact_id && (
                      <>
                        <span className="text-slate-300">·</span>
                        <Link href={`/app/contacts/${r.contact_id}`} className="text-blue-600 hover:underline">
                          {contactName}
                        </Link>
                      </>
                    )}
                    {propertyName && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span>{propertyName}</span>
                      </>
                    )}
                    <span className="text-slate-300">·</span>
                    <span title={exactDate(r.happened_at)}>{exactDate(r.happened_at)}</span>
                  </div>

                  {r.notes && (
                    <p className="mt-2 text-sm text-slate-600">
                      {isOpen || !longNote ? r.notes : `${r.notes.slice(0, 140)}…`}
                      {longNote && (
                        <button
                          onClick={() => toggleNote(r.id)}
                          className="ml-1 text-xs font-medium text-blue-600 hover:underline"
                        >
                          {isOpen ? "Show less" : "Show more"}
                        </button>
                      )}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {visibleCount < rows.length && (
            <div className="flex justify-center">
              <button
                onClick={() => setVisibleCount((v) => v + FEED_PAGE)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Load more ({rows.length - visibleCount} more)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
