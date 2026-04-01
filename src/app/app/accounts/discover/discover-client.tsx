"use client";

import { useState } from "react";
import Link from "next/link";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { formatPhone } from "@/lib/utils/format";
import type {
  IntelBusiness,
  IntelEntity,
  IntelProperty,
  TerritoryInfo,
} from "./page";

type Tab = "businesses" | "owners" | "properties";

const SOURCE_BADGES: Record<string, { label: string; cls: string }> = {
  edgar_10k_address: { label: "REIT", cls: "bg-purple-100 text-purple-700" },
  google_places: { label: "Google Places", cls: "bg-blue-100 text-blue-700" },
  cms_healthcare: { label: "CMS", cls: "bg-teal-100 text-teal-700" },
  web_intelligence: { label: "Web Intel", cls: "bg-amber-100 text-amber-700" },
};

function scoreBadge(score: number) {
  const color =
    score >= 60
      ? "bg-green-100 text-green-700"
      : score >= 40
        ? "bg-amber-100 text-amber-700"
        : "bg-slate-100 text-slate-500";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {score}
    </span>
  );
}

function fmtSqft(n: number | null): string {
  if (n == null) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M sqft`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K sqft`;
  return `${n} sqft`;
}

export default function DiscoverClient({
  businesses,
  entities,
  properties,
  territory,
  orgId,
  userId,
}: {
  businesses: IntelBusiness[];
  entities: IntelEntity[];
  properties: IntelProperty[];
  territory: TerritoryInfo;
  orgId: string;
  userId: string;
}) {
  const supabase = createBrowserSupabase();
  const [tab, setTab] = useState<Tab>("businesses");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [converting, setConverting] = useState<string | null>(null);
  const [converted, setConverted] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  // ── No territory empty state ───────────────────────────────────────────
  if (!territory.hasTerritory) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-center">
        <Link
          href="/app/accounts"
          className="mb-4 inline-block text-sm text-slate-500 hover:text-slate-800"
        >
          &larr; Back to Accounts
        </Link>
        <div className="rounded-2xl border border-slate-200 bg-white p-8">
          <h1 className="text-lg font-semibold text-slate-900">
            No Territory Assigned
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            You don&apos;t have a territory assigned yet. Ask your manager to
            assign you a territory so you can discover accounts in your area.
          </p>
        </div>
      </div>
    );
  }

  // ── Filter businesses by source ────────────────────────────────────────
  const filteredBusinesses = businesses.filter((b) => {
    if (converted.has(b.id)) return false;
    if (sourceFilter !== "all" && b.source_detail !== sourceFilter) return false;
    return true;
  });

  const filteredProperties = properties.filter((p) => !converted.has(p.id));

  // ── Add to Pipeline action ─────────────────────────────────────────────
  async function addToPipeline(b: IntelBusiness) {
    setConverting(b.id);
    try {
      // 1. Create account
      const { data: account, error: acctErr } = await supabase
        .from("accounts")
        .insert({
          org_id: orgId,
          created_by: userId,
          name: b.company_name,
          account_type: b.account_type || "other",
          website: null,
          phone: b.contact_phone || null,
        })
        .select("id")
        .single();

      if (acctErr) {
        showToast("Error creating account: " + acctErr.message);
        return;
      }

      // 2. Create contact if name available
      const contactName = [b.contact_first_name, b.contact_last_name]
        .filter(Boolean)
        .join(" ");
      if (contactName) {
        await supabase.from("contacts").insert({
          org_id: orgId,
          created_by: userId,
          account_id: account.id,
          full_name: contactName,
          first_name: b.contact_first_name || null,
          last_name: b.contact_last_name || null,
          title: b.contact_title || null,
          email: b.contact_email || null,
          phone: b.contact_phone || null,
        });
      }

      // 3. Mark intel_prospect as converted (via admin — no RLS on intel_prospects)
      // We use the org-scoped client to avoid needing admin here;
      // the prospect status update will happen via the next distributor run
      // or we can just track it locally
      setConverted((prev) => new Set(prev).add(b.id));
      showToast("Added! Check your Accounts list.");
    } catch (err) {
      showToast("Error: " + (err instanceof Error ? err.message : "unknown"));
    } finally {
      setConverting(null);
    }
  }

  async function addPropertyToPipeline(p: IntelProperty) {
    setConverting(p.id);
    try {
      // 1. Create account from owner name
      const accountName = p.owner_name || p.property_name || "Unknown Owner";
      const { data: account, error: acctErr } = await supabase
        .from("accounts")
        .insert({
          org_id: orgId,
          created_by: userId,
          name: accountName,
          account_type: "owner",
        })
        .select("id")
        .single();

      if (acctErr) {
        showToast("Error: " + acctErr.message);
        return;
      }

      // 2. Create property
      if (p.street_address && p.city && p.state) {
        await supabase.from("properties").insert({
          org_id: orgId,
          created_by: userId,
          name: p.property_name || null,
          address_line1: p.street_address,
          city: p.city,
          state: p.state.toUpperCase(),
          postal_code: p.postal_code || "00000",
          primary_account_id: account.id,
        });
      }

      setConverted((prev) => new Set(prev).add(p.id));
      showToast("Added! Property and account created.");
    } catch (err) {
      showToast("Error: " + (err instanceof Error ? err.message : "unknown"));
    } finally {
      setConverting(null);
    }
  }

  // ── Sources for filter ─────────────────────────────────────────────────
  const sources = [...new Set(businesses.map((b) => b.source_detail))];

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "businesses", label: "Businesses", count: filteredBusinesses.length },
    { key: "owners", label: "Portfolio Owners", count: entities.length },
    { key: "properties", label: "Properties", count: filteredProperties.length },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {/* Toast */}
      {toast && (
        <div className="fixed right-4 top-4 z-50 rounded-xl border border-green-200 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <Link
            href="/app/accounts"
            className="mb-1 inline-block text-sm text-slate-500 hover:text-slate-800"
          >
            &larr; Back to Accounts
          </Link>
          <h1 className="text-xl font-bold text-slate-900">
            Find Accounts in My Territory
          </h1>
          <p className="text-sm text-slate-500">
            {territory.cities.map((c) => c.charAt(0).toUpperCase() + c.slice(1)).join(", ")}{" "}
            ({territory.states.map((s) => s.toUpperCase()).join(", ")})
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
            <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Source filter (businesses tab only) */}
      {tab === "businesses" && sources.length > 1 && (
        <div className="mb-4 flex gap-2">
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="all">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {SOURCE_BADGES[s]?.label ?? s}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ── TAB 1: Businesses ──────────────────────────────────────────── */}
      {tab === "businesses" && (
        <>
          {filteredBusinesses.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
              No intel data found for your territory yet. Check back Monday
              after the weekly agent run.
            </div>
          ) : (
            <div className="space-y-2">
              {filteredBusinesses.map((b) => (
                <div
                  key={b.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900">
                          {b.company_name}
                        </span>
                        {SOURCE_BADGES[b.source_detail] && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${SOURCE_BADGES[b.source_detail].cls}`}
                          >
                            {SOURCE_BADGES[b.source_detail].label}
                          </span>
                        )}
                        {scoreBadge(b.confidence_score)}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {[b.address_line1, b.city, b.state]
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                      {(b.contact_first_name || b.contact_last_name) && (
                        <div className="mt-1 text-xs text-slate-600">
                          <span className="font-medium">
                            {[b.contact_first_name, b.contact_last_name]
                              .filter(Boolean)
                              .join(" ")}
                          </span>
                          {b.contact_title && (
                            <span className="text-slate-400">
                              {" "}
                              &middot; {b.contact_title}
                            </span>
                          )}
                          {b.contact_phone && (
                            <a
                              href={`tel:${b.contact_phone}`}
                              className="ml-2 text-blue-600 font-medium hover:underline"
                            >
                              {formatPhone(b.contact_phone)}
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={converting === b.id}
                      onClick={() => addToPipeline(b)}
                      className="shrink-0 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {converting === b.id ? "Adding..." : "Add to Pipeline"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── TAB 2: Portfolio Owners ─────────────────────────────────────── */}
      {tab === "owners" && (
        <>
          {entities.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
              No portfolio owners found with properties in your territory.
            </div>
          ) : (
            <div className="space-y-2">
              {entities.map((e) => (
                <div
                  key={e.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">
                          {e.name}
                        </span>
                        {e.ticker && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                            {e.ticker}
                          </span>
                        )}
                        {e.entity_type && (
                          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700">
                            {e.entity_type}
                          </span>
                        )}
                      </div>
                      {e.total_properties && (
                        <div className="mt-0.5 text-xs text-slate-500">
                          {e.total_properties.toLocaleString()} properties
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {e.markets.slice(0, 5).map((m, i) => (
                          <span
                            key={i}
                            className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
                          >
                            {m.name}
                            {m.property_count
                              ? ` (${m.property_count})`
                              : ""}
                            {m.sq_footage_sf
                              ? ` · ${fmtSqft(m.sq_footage_sf)}`
                              : ""}
                          </span>
                        ))}
                        {e.markets.length > 5 && (
                          <span className="text-xs text-slate-400">
                            +{e.markets.length - 5} more
                          </span>
                        )}
                      </div>
                    </div>
                    <Link
                      href={`/app/intel/entities`}
                      className="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Research
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── TAB 3: Properties ──────────────────────────────────────────── */}
      {tab === "properties" && (
        <>
          {filteredProperties.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
              No unlinked properties found in your territory yet.
            </div>
          ) : (
            <div className="space-y-2">
              {filteredProperties.map((p) => (
                <div
                  key={p.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900">
                          {p.property_name || p.street_address || "Unknown"}
                        </span>
                        {p.property_type && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                            {p.property_type}
                          </span>
                        )}
                        {scoreBadge(p.confidence_score)}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {[p.street_address, p.city, p.state]
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                      <div className="mt-1 flex gap-3 text-xs text-slate-500">
                        {p.owner_name && <span>Owner: {p.owner_name}</span>}
                        {p.sq_footage && <span>{fmtSqft(p.sq_footage)}</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={converting === p.id}
                      onClick={() => addPropertyToPipeline(p)}
                      className="shrink-0 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {converting === p.id ? "Adding..." : "Add to Pipeline"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
