"use client";

import { useState } from "react";
import type { EntityRow } from "./page";

export default function EntitiesClient({ entities }: { entities: EntityRow[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = entities.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.name.toLowerCase().includes(q) ||
      (e.ticker ?? "").toLowerCase().includes(q)
    );
  });

  const withPortfolio = filtered.filter((e) => e.portfolio.filing_type);
  const withoutPortfolio = filtered.filter((e) => !e.portfolio.filing_type);

  function toggle(id: string) {
    setExpandedId(expandedId === id ? null : id);
  }

  function filingBadge(type: string | null) {
    if (!type) return <span className="text-xs text-slate-400">—</span>;
    const colors: Record<string, string> = {
      type_a: "bg-green-100 text-green-700",
      type_b: "bg-blue-100 text-blue-700",
      type_c: "bg-slate-100 text-slate-500",
    };
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[type] ?? "bg-slate-100 text-slate-500"}`}>
        {type.replace("type_", "").toUpperCase()}
      </span>
    );
  }

  function fmtNum(n: number | null): string {
    if (n == null) return "—";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return String(n);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Entity Intelligence</h1>
          <p className="text-sm text-slate-500">
            {entities.length} entities tracked — {withPortfolio.length} with portfolio data
          </p>
        </div>
        <input
          type="text"
          placeholder="Search by name or ticker..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 sm:w-64"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          No entities found. Run the EDGAR Intelligence Agent to populate data.
        </div>
      ) : (
        <div className="space-y-2">
          {[...withPortfolio, ...withoutPortfolio].map((e) => (
            <div key={e.id} className="rounded-2xl border border-slate-200 bg-white">
              {/* Row header */}
              <button
                type="button"
                onClick={() => toggle(e.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
              >
                <span className="text-xs text-slate-400">
                  {expandedId === e.id ? "▼" : "▶"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">{e.name}</span>
                    {e.ticker && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                        {e.ticker}
                      </span>
                    )}
                    {filingBadge(e.portfolio.filing_type)}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                    <span>Properties: {fmtNum(e.portfolio.total_properties)}</span>
                    <span>Markets: {e.portfolio.markets.length || "—"}</span>
                    {e.portfolio.capex_annual_usd && (
                      <span>CapEx: ${fmtNum(e.portfolio.capex_annual_usd)}</span>
                    )}
                    <span>Contacts: {e.contacts.length + e.portfolio.decision_makers.length}</span>
                    {e.last_10k_date && <span>10-K: {e.last_10k_date}</span>}
                  </div>
                </div>
              </button>

              {/* Expanded detail */}
              {expandedId === e.id && (
                <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                  {/* Markets */}
                  {e.portfolio.markets.length > 0 && (
                    <div className="mb-4">
                      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">
                        Markets ({e.portfolio.markets.length})
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-slate-100 text-xs text-slate-400">
                              <th className="px-2 py-1">Market</th>
                              <th className="px-2 py-1">State</th>
                              <th className="px-2 py-1 text-right">Properties</th>
                              <th className="px-2 py-1 text-right">Sq Ft</th>
                              <th className="px-2 py-1">Type</th>
                            </tr>
                          </thead>
                          <tbody>
                            {e.portfolio.markets.map((m, i) => (
                              <tr key={i} className="border-b border-slate-50">
                                <td className="px-2 py-1 font-medium text-slate-700">{m.name}</td>
                                <td className="px-2 py-1 text-slate-500">{m.state ?? "—"}</td>
                                <td className="px-2 py-1 text-right text-slate-700">{fmtNum(m.property_count)}</td>
                                <td className="px-2 py-1 text-right text-slate-700">{fmtNum(m.sq_footage_sf)}</td>
                                <td className="px-2 py-1 text-slate-500">{m.property_type}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Decision makers + contacts */}
                  {(e.contacts.length > 0 || e.portfolio.decision_makers.length > 0) && (
                    <div className="mb-4">
                      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">
                        Contacts
                      </h3>
                      <div className="space-y-1">
                        {[...e.portfolio.decision_makers.map((d) => ({
                          full_name: d.name,
                          title: d.title,
                          contact_type: d.contact_type,
                        })), ...e.contacts].map((c, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm">
                            <span className="font-medium text-slate-700">{c.full_name}</span>
                            {c.title && <span className="text-slate-400">— {c.title}</span>}
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                              {c.contact_type}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Subsidiaries */}
                  {e.portfolio.subsidiaries.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">
                        Subsidiaries ({e.portfolio.subsidiaries.length})
                      </h3>
                      <div className="flex flex-wrap gap-1">
                        {e.portfolio.subsidiaries.slice(0, 20).map((s, i) => (
                          <span key={i} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                            {s}
                          </span>
                        ))}
                        {e.portfolio.subsidiaries.length > 20 && (
                          <span className="text-xs text-slate-400">
                            +{e.portfolio.subsidiaries.length - 20} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {e.portfolio.markets.length === 0 &&
                    e.contacts.length === 0 &&
                    e.portfolio.decision_makers.length === 0 &&
                    e.portfolio.subsidiaries.length === 0 && (
                      <p className="text-sm text-slate-400">
                        No portfolio data yet. This entity will be processed in the next EDGAR run.
                      </p>
                    )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
