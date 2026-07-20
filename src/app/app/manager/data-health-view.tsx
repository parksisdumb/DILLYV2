"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { propertyDuplicateKey } from "@/lib/address";
import {
  accountCompleteness,
  contactCompleteness,
  propertyCompleteness,
  opportunityCompleteness,
  averageScore,
  withinDays,
  type CompletenessResult,
  type RecordType,
} from "@/lib/completeness";

export type DataHealthRep = { userId: string; name: string };

type Scored = {
  id: string;
  type: RecordType;
  label: string;
  href: string;
  createdBy: string | null;
  result: CompletenessResult;
};

const TYPE_META: { type: RecordType; label: string; plural: string }[] = [
  { type: "account", label: "Account", plural: "Accounts" },
  { type: "contact", label: "Contact", plural: "Contacts" },
  { type: "property", label: "Property", plural: "Properties" },
  { type: "opportunity", label: "Opportunity", plural: "Opportunities" },
];

const FETCH_CAP = 2000;
const TOUCH_CAP = 5000;

function pct(score: number): string {
  return `${score}%`;
}
function scoreColor(score: number): string {
  if (score >= 80) return "text-green-700";
  if (score >= 50) return "text-amber-700";
  return "text-red-700";
}

export default function DataHealthView({ reps, orgId }: { reps: DataHealthRep[]; orgId: string }) {
  const supabase = useMemo(() => createBrowserSupabase(), []);
  void orgId; // RLS scopes everything to the manager's org.

  const [scored, setScored] = useState<Scored[]>([]);
  const [propRows, setPropRows] = useState<
    { id: string; name: string | null; address_line1: string; city: string | null; state: string | null }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<RecordType>("property");

  const repName = useMemo(() => new Map(reps.map((r) => [r.userId, r.name])), [reps]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 7 batched queries — no per-record round trips. RLS scopes to org.
      const [accRes, conRes, propRes, oppRes, pcRes, tpRes] = await Promise.all([
        supabase.from("accounts").select("id,name,account_type,website,onboarding_status,created_by").is("deleted_at", null).limit(FETCH_CAP),
        supabase
          .from("contacts")
          .select("id,first_name,last_name,full_name,title,phone,email,created_by")
          .is("deleted_at", null)
          .limit(FETCH_CAP),
        supabase
          .from("properties")
          .select("id,name,address_line1,city,state,roof_type,sq_footage,roof_age_years,primary_account_id,created_by")
          .is("deleted_at", null)
          .limit(FETCH_CAP),
        supabase
          .from("opportunities")
          .select("id,title,stage_id,scope_type_id,estimated_value,status,account_id,property_id,created_by")
          .is("deleted_at", null)
          .limit(FETCH_CAP),
        supabase.from("property_contacts").select("property_id,contact_id").eq("active", true),
        supabase
          .from("touchpoints")
          .select("account_id,property_id,opportunity_id,happened_at")
          .order("happened_at", { ascending: false })
          .limit(TOUCH_CAP),
      ]);

      const firstErr = [accRes, conRes, propRes, oppRes, pcRes, tpRes].find((r) => r.error)?.error;
      if (firstErr) throw new Error(firstErr.message);

      // Relational signal maps.
      const contactCountByAccount = new Map<string, number>();
      for (const c of (conRes.data ?? []) as { account_id?: string | null }[]) {
        const a = (c as { account_id?: string | null }).account_id;
        if (a) contactCountByAccount.set(a, (contactCountByAccount.get(a) ?? 0) + 1);
      }
      const propCountByAccount = new Map<string, number>();
      for (const p of (propRes.data ?? []) as { primary_account_id: string | null }[]) {
        if (p.primary_account_id) propCountByAccount.set(p.primary_account_id, (propCountByAccount.get(p.primary_account_id) ?? 0) + 1);
      }
      const wonByAccount = new Set<string>();
      for (const o of (oppRes.data ?? []) as { account_id: string | null; status?: string | null }[]) {
        if (o.account_id && o.status === "won") wonByAccount.add(o.account_id);
      }
      const lastTouchByAccount = new Map<string, string>();
      const propIdsWithTouch = new Set<string>();
      const oppIdsWithTouch = new Set<string>();
      for (const t of (tpRes.data ?? []) as { account_id: string | null; property_id: string | null; opportunity_id: string | null; happened_at: string }[]) {
        if (t.account_id && !lastTouchByAccount.has(t.account_id)) lastTouchByAccount.set(t.account_id, t.happened_at); // desc order → first is latest
        if (t.property_id) propIdsWithTouch.add(t.property_id);
        if (t.opportunity_id) oppIdsWithTouch.add(t.opportunity_id);
      }
      const contactIdsLinked = new Set<string>();
      const propIdsLinked = new Set<string>();
      for (const pc of (pcRes.data ?? []) as { property_id: string; contact_id: string }[]) {
        contactIdsLinked.add(pc.contact_id);
        propIdsLinked.add(pc.property_id);
      }

      const out: Scored[] = [];

      for (const a of (accRes.data ?? []) as { id: string; name: string | null; account_type: string | null; website: string | null; onboarding_status: string | null; created_by: string | null }[]) {
        out.push({
          id: a.id,
          type: "account",
          label: a.name ?? "Account",
          href: `/app/accounts/${a.id}`,
          createdBy: a.created_by,
          result: accountCompleteness({
            account_type: a.account_type,
            website: a.website,
            hasContact: (contactCountByAccount.get(a.id) ?? 0) > 0,
            hasProperty: (propCountByAccount.get(a.id) ?? 0) > 0,
            recentTouch: withinDays(lastTouchByAccount.get(a.id) ?? null, 90),
            onboarding_status: a.onboarding_status ?? "initial_touch",
            hasWonOpportunity: wonByAccount.has(a.id),
          }),
        });
      }

      for (const c of (conRes.data ?? []) as { id: string; first_name: string | null; last_name: string | null; full_name: string | null; title: string | null; phone: string | null; email: string | null; created_by: string | null }[]) {
        out.push({
          id: c.id,
          type: "contact",
          label: c.full_name ?? "Contact",
          href: `/app/contacts/${c.id}`,
          createdBy: c.created_by,
          result: contactCompleteness({
            first_name: c.first_name,
            last_name: c.last_name,
            title: c.title,
            phone: c.phone,
            email: c.email,
            hasProperty: contactIdsLinked.has(c.id),
          }),
        });
      }

      const propList = (propRes.data ?? []) as { id: string; name: string | null; address_line1: string; city: string | null; state: string | null; roof_type: string | null; sq_footage: number | null; roof_age_years: number | null; primary_account_id: string | null; created_by: string | null }[];
      for (const p of propList) {
        out.push({
          id: p.id,
          type: "property",
          label: p.name?.trim() || p.address_line1,
          href: `/app/properties/${p.id}`,
          createdBy: p.created_by,
          result: propertyCompleteness({
            roof_type: p.roof_type,
            sq_footage: p.sq_footage,
            roof_age_years: p.roof_age_years,
            primary_account_id: p.primary_account_id,
            hasContact: propIdsLinked.has(p.id),
          }),
        });
      }
      setPropRows(
        propList.map((p) => ({
          id: p.id,
          name: p.name,
          address_line1: p.address_line1,
          city: p.city,
          state: p.state,
        })),
      );

      for (const o of (oppRes.data ?? []) as { id: string; title: string | null; stage_id: string | null; scope_type_id: string | null; estimated_value: number | null; account_id: string | null; property_id: string | null; created_by: string | null }[]) {
        out.push({
          id: o.id,
          type: "opportunity",
          label: o.title ?? "Opportunity",
          href: `/app/opportunities/${o.id}`,
          createdBy: o.created_by,
          result: opportunityCompleteness({
            stage_id: o.stage_id,
            scope_type_id: o.scope_type_id,
            estimated_value: o.estimated_value,
            account_id: o.account_id,
            hasTouchpoint: oppIdsWithTouch.has(o.id) || (o.property_id ? propIdsWithTouch.has(o.property_id) : false),
          }),
        });
      }

      setScored(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  // Overall % per type.
  const byType = useMemo(() => {
    const m = new Map<RecordType, Scored[]>();
    for (const s of scored) {
      if (!m.has(s.type)) m.set(s.type, []);
      m.get(s.type)!.push(s);
    }
    return m;
  }, [scored]);

  // Worst-first list for the active type (incomplete only).
  const worstForActive = useMemo(() => {
    return (byType.get(activeType) ?? [])
      .filter((s) => s.result.score < 100)
      .sort((a, b) => a.result.score - b.result.score)
      .slice(0, 15);
  }, [byType, activeType]);

  // Possible duplicate properties — normalized address_line1 + city collisions.
  const dupGroups = useMemo(() => {
    const groups = new Map<
      string,
      { id: string; name: string | null; address_line1: string; city: string | null; state: string | null }[]
    >();
    for (const p of propRows) {
      const key = propertyDuplicateKey(p.address_line1, p.city);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    return Array.from(groups.values())
      .filter((g) => g.length > 1)
      .sort((a, b) => b.length - a.length);
  }, [propRows]);

  // Completeness by rep (across all record types) — worst first.
  const byRep = useMemo(() => {
    const m = new Map<string, CompletenessResult[]>();
    for (const s of scored) {
      const key = s.createdBy ?? "__none__";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(s.result);
    }
    return Array.from(m.entries())
      .map(([key, results]) => ({
        userId: key,
        name: key === "__none__" ? "Unassigned" : repName.get(key) ?? `${key.slice(0, 8)}…`,
        avg: averageScore(results),
        count: results.length,
        gaps: results.reduce((s, r) => s + r.missing.length, 0),
      }))
      .filter((r) => r.count > 0)
      .sort((a, b) => a.avg - b.avg);
  }, [scored, repName]);

  if (loading) return <p className="text-sm text-slate-500">Computing data health…</p>;
  if (error) return <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;

  return (
    <div className="space-y-5">
      {/* Overall % by record type */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {TYPE_META.map((t) => {
          const list = byType.get(t.type) ?? [];
          const avg = averageScore(list.map((s) => s.result));
          return (
            <button
              key={t.type}
              onClick={() => setActiveType(t.type)}
              className={`rounded-2xl border p-4 text-left transition-colors ${
                activeType === t.type ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <div className={`text-2xl font-bold tabular-nums ${list.length === 0 ? "text-slate-300" : scoreColor(avg)}`}>
                {list.length === 0 ? "—" : pct(avg)}
              </div>
              <div className="text-xs text-slate-500">
                {t.plural} · {list.length}
              </div>
            </button>
          );
        })}
      </div>

      {/* Least-complete records for the selected type */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">
          Least-complete {TYPE_META.find((t) => t.type === activeType)?.plural} — fix worst first
        </h3>
        {worstForActive.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            No incomplete records of this type. 🎉
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {worstForActive.map((s) => (
              <Link
                key={s.id}
                href={s.href}
                className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0 hover:bg-slate-50"
              >
                <span className={`w-12 shrink-0 text-sm font-bold tabular-nums ${scoreColor(s.result.score)}`}>
                  {pct(s.result.score)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{s.label}</span>
                <span className="hidden min-w-0 max-w-[55%] truncate text-xs text-slate-500 sm:block">
                  {s.result.missing.map((m) => m.label).join(", ")}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Possible duplicate properties */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">
          Possible duplicate properties{dupGroups.length > 0 ? ` — ${dupGroups.length}` : ""}
        </h3>
        {dupGroups.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            No duplicate addresses detected. 🎉
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Same normalized street address + city (ignores case, punctuation, and St/Street,
              Dr/Drive, etc.). Open a record and use “Merge…” to fold duplicates together.
            </p>
            {dupGroups.map((g) => (
              <div key={g[0].id} className="overflow-hidden rounded-2xl border border-amber-200 bg-white">
                <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800">
                  {g.length} records · {g[0].address_line1}
                  {g[0].city ? `, ${g[0].city}` : ""}
                  {g[0].state ? ` ${g[0].state}` : ""}
                </div>
                {g.map((p) => (
                  <Link
                    key={p.id}
                    href={`/app/properties/${p.id}`}
                    className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0 hover:bg-slate-50"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
                      {p.name?.trim() || p.address_line1}
                    </span>
                    <span className="hidden min-w-0 max-w-[55%] truncate text-xs text-slate-500 sm:block">
                      {[p.address_line1, p.city, p.state].filter(Boolean).join(", ")}
                    </span>
                  </Link>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Completeness by rep */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Completeness by rep — coaching lever</h3>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5 font-medium">Rep</th>
                <th className="px-4 py-2.5 text-right font-medium">Avg complete</th>
                <th className="px-4 py-2.5 text-right font-medium">Records</th>
                <th className="px-4 py-2.5 text-right font-medium">Total gaps</th>
              </tr>
            </thead>
            <tbody>
              {byRep.map((r) => (
                <tr key={r.userId} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-slate-900">{r.name}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${scoreColor(r.avg)}`}>{pct(r.avg)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.count}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.gaps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
