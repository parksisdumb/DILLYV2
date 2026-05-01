"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { RepInfo } from "./page";

type Period = "7d" | "30d" | "90d";

const PERIOD_DAYS: Record<Period, number> = { "7d": 7, "30d": 30, "90d": 90 };
const PERIOD_LABELS: Record<Period, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days" };
const MIN_DATA_POINTS = 5;
const COLOR_DELTA = 0.10; // 10pp above/below team avg

type FunnelRow = {
  repId: string;
  repName: string;
  totalTouchpoints: number;
  s1: number | null; // First Touch → Connected
  s2: number | null; // Connected → Inspection
  s3: number | null; // Inspection → Proposal (i.e. reached bid_submitted)
  s4: number | null; // Proposal → Won
};

type TeamAvg = { s1: number | null; s2: number | null; s3: number | null; s4: number | null };

export default function ConversionFunnelSection({ reps }: { reps: RepInfo[] }) {
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const [period, setPeriod] = useState<Period>("30d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<FunnelRow[]>([]);
  const [teamAvg, setTeamAvg] = useState<TeamAvg>({ s1: null, s2: null, s3: null, s4: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const periodStart = new Date(Date.now() - PERIOD_DAYS[period] * 86400000).toISOString();

        const [tpsRes, outcomesRes, oppsRes, assignsRes, stagesRes] = await Promise.all([
          supabase
            .from("touchpoints")
            .select("rep_user_id,contact_id,outcome_id,engagement_phase,happened_at")
            .gte("happened_at", periodStart),
          supabase.from("touchpoint_outcomes").select("id,key"),
          supabase
            .from("opportunities")
            .select("id,primary_contact_id,stage_id,status,closed_at")
            .is("deleted_at", null),
          supabase.from("opportunity_assignments").select("opportunity_id,user_id,is_primary,assignment_role"),
          supabase.from("opportunity_stages").select("id,key,sort_order"),
        ]);

        if (cancelled) return;

        const firstError = [tpsRes.error, outcomesRes.error, oppsRes.error, assignsRes.error, stagesRes.error].find(Boolean);
        if (firstError) throw new Error(firstError.message);

        // Lookups
        const outcomeKeyById = new Map<string, string>();
        for (const o of (outcomesRes.data ?? []) as { id: string; key: string }[]) {
          outcomeKeyById.set(o.id, o.key);
        }

        const stageOrderById = new Map<string, number>();
        let bidStageOrder = 50; // fallback if seed missing
        for (const s of (stagesRes.data ?? []) as { id: string; key: string; sort_order: number }[]) {
          stageOrderById.set(s.id, s.sort_order);
          if (s.key === "bid_submitted") bidStageOrder = s.sort_order;
        }

        // Primary rep per opportunity (is_primary first, then assignment_role='primary_rep')
        type Assign = { opportunity_id: string; user_id: string; is_primary: boolean; assignment_role: string | null };
        const assigns = (assignsRes.data ?? []) as Assign[];
        const repByOppId = new Map<string, string>();
        for (const a of assigns) {
          if (a.is_primary && !repByOppId.has(a.opportunity_id)) {
            repByOppId.set(a.opportunity_id, a.user_id);
          }
        }
        for (const a of assigns) {
          if (!repByOppId.has(a.opportunity_id) && a.assignment_role === "primary_rep") {
            repByOppId.set(a.opportunity_id, a.user_id);
          }
        }

        // Group opps by rep
        type Opp = { id: string; primary_contact_id: string | null; stage_id: string; status: string; closed_at: string | null };
        const oppsByRep = new Map<string, Opp[]>();
        for (const o of (oppsRes.data ?? []) as Opp[]) {
          const repId = repByOppId.get(o.id);
          if (!repId) continue;
          if (!oppsByRep.has(repId)) oppsByRep.set(repId, []);
          oppsByRep.get(repId)!.push(o);
        }

        // Group touchpoints by rep, enriched with outcome key
        type Tp = {
          rep_user_id: string;
          contact_id: string | null;
          outcome_id: string | null;
          engagement_phase: string | null;
          happened_at: string;
        };
        type TpEnriched = Tp & { outcomeKey: string | null };
        const tpsByRep = new Map<string, TpEnriched[]>();
        for (const tp of (tpsRes.data ?? []) as Tp[]) {
          const enriched: TpEnriched = {
            ...tp,
            outcomeKey: tp.outcome_id ? outcomeKeyById.get(tp.outcome_id) ?? null : null,
          };
          if (!tpsByRep.has(tp.rep_user_id)) tpsByRep.set(tp.rep_user_id, []);
          tpsByRep.get(tp.rep_user_id)!.push(enriched);
        }

        // Compute funnel per rep
        const computed: FunnelRow[] = reps.map((rep) => {
          const repTps = (tpsByRep.get(rep.id) ?? []).filter((t) => t.contact_id);
          const totalTouchpoints = repTps.length;
          const insufficient = totalTouchpoints < MIN_DATA_POINTS;

          // S1 denominator: contacts touched in first_touch phase
          const firstTouchContacts = new Set(
            repTps.filter((t) => t.engagement_phase === "first_touch").map((t) => t.contact_id as string),
          );

          // S1 numerator + earliest connected timestamp per contact (for S2 "after" check)
          const firstConnectedAtByContact = new Map<string, string>();
          for (const t of repTps) {
            if (t.outcomeKey === "connected_conversation" && t.contact_id) {
              const existing = firstConnectedAtByContact.get(t.contact_id);
              if (!existing || t.happened_at < existing) {
                firstConnectedAtByContact.set(t.contact_id, t.happened_at);
              }
            }
          }
          const connectedContacts = new Set(firstConnectedAtByContact.keys());

          // S2 numerator: contacts with inspection_scheduled outcome AFTER their first connected_conversation
          const inspectedContacts = new Set<string>();
          for (const t of repTps) {
            if (t.outcomeKey !== "inspection_scheduled" || !t.contact_id) continue;
            const firstConnectedAt = firstConnectedAtByContact.get(t.contact_id);
            if (firstConnectedAt && t.happened_at > firstConnectedAt) {
              inspectedContacts.add(t.contact_id);
            }
          }

          // S3 numerator: opps owned by rep whose primary_contact_id is in inspectedContacts
          //               AND current stage sort_order >= bid_submitted's sort_order
          const repOpps = oppsByRep.get(rep.id) ?? [];
          const proposalReachedOpps = repOpps.filter((o) => {
            if (!o.primary_contact_id || !inspectedContacts.has(o.primary_contact_id)) return false;
            const order = stageOrderById.get(o.stage_id) ?? 0;
            return order >= bidStageOrder;
          });

          // S4 numerator: opps owned by rep with status='won' AND closed_at within period
          const wonOpps = repOpps.filter(
            (o) => o.status === "won" && o.closed_at && o.closed_at >= periodStart,
          );

          return {
            repId: rep.id,
            repName: rep.name,
            totalTouchpoints,
            s1: insufficient || firstTouchContacts.size === 0 ? null : connectedContacts.size / firstTouchContacts.size,
            s2: insufficient || connectedContacts.size === 0 ? null : inspectedContacts.size / connectedContacts.size,
            s3: insufficient || inspectedContacts.size === 0 ? null : proposalReachedOpps.length / inspectedContacts.size,
            s4: insufficient || proposalReachedOpps.length === 0 ? null : wonOpps.length / proposalReachedOpps.length,
          };
        });

        const avg = (getter: (r: FunnelRow) => number | null): number | null => {
          const vals = computed.map(getter).filter((v): v is number => v !== null);
          if (vals.length === 0) return null;
          return vals.reduce((s, v) => s + v, 0) / vals.length;
        };

        setRows(computed);
        setTeamAvg({
          s1: avg((r) => r.s1),
          s2: avg((r) => r.s2),
          s3: avg((r) => r.s3),
          s4: avg((r) => r.s4),
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period, reps, supabase]);

  function cellColor(value: number | null, teamVal: number | null): string {
    if (value === null || teamVal === null) return "";
    const diff = value - teamVal;
    if (diff >= COLOR_DELTA) return "bg-green-50 text-green-800";
    if (diff <= -COLOR_DELTA) return "bg-red-50 text-red-800";
    return "";
  }

  function formatPct(value: number | null): string {
    if (value === null) return "—";
    return `${Math.round(value * 100)}%`;
  }

  // Coaching callouts — only emit when threshold breached AND rep has enough data
  const callouts: string[] = [];
  for (const r of rows) {
    if (r.totalTouchpoints < MIN_DATA_POINTS) continue;
    if (r.s1 !== null && r.s1 < 0.25) {
      callouts.push(`${r.repName}'s connect rate is low. Review call timing and opening lines.`);
    }
    if (r.s2 !== null && r.s2 < 0.20) {
      callouts.push(`${r.repName} is having conversations but not booking inspections. Coach on the ask.`);
    }
    if (r.s3 !== null && r.s3 < 0.60) {
      callouts.push(`${r.repName} is getting on roofs but proposals aren't following. Check inspection note quality.`);
    }
    if (r.s4 !== null && r.s4 < 0.30) {
      callouts.push(`${r.repName}'s close rate needs attention. Review proposal quality and follow-up cadence.`);
    }
  }

  const teamCells: (number | null)[] = [teamAvg.s1, teamAvg.s2, teamAvg.s3, teamAvg.s4];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Conversion Funnel
        </h2>
        <div className="flex gap-1.5">
          {(["7d", "30d", "90d"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={[
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                period === p
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              ].join(" ")}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm text-slate-400">Loading…</p>
      ) : error ? (
        <p className="py-4 text-center text-sm text-red-600">{error}</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No reps in this org.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Rep</th>
                  <th className="px-3 py-2 text-center">1st → Talk</th>
                  <th className="px-3 py-2 text-center">Talk → Insp</th>
                  <th className="px-3 py-2 text-center">Insp → Prop</th>
                  <th className="px-3 py-2 text-center">Prop → Won</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const insufficient = r.totalTouchpoints < MIN_DATA_POINTS;
                  const cells: (number | null)[] = [r.s1, r.s2, r.s3, r.s4];
                  return (
                    <tr key={r.repId} className="border-b border-slate-100 last:border-b-0">
                      <td className="px-3 py-2 font-medium text-slate-900">{r.repName}</td>
                      {cells.map((val, i) => (
                        <td
                          key={i}
                          title={insufficient ? "Not enough data" : undefined}
                          className={`px-3 py-2 text-center tabular-nums ${cellColor(val, teamCells[i])}`}
                        >
                          {formatPct(val)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Team Avg
                  </td>
                  {teamCells.map((v, i) => (
                    <td key={i} className="px-3 py-2 text-center font-semibold tabular-nums text-slate-700">
                      {formatPct(v)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-4 space-y-1.5">
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Coaching Flags
            </h3>
            {callouts.length === 0 ? (
              <p className="text-sm text-slate-500">No coaching flags for this period.</p>
            ) : (
              callouts.map((c, i) => (
                <p key={i} className="text-sm text-slate-700">
                  • {c}
                </p>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
