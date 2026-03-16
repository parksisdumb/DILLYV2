import Link from "next/link";
import { redirect } from "next/navigation";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import PenetrationClient from "./penetration-client";

// ── Types exported to client ────────────────────────────────────────────────

export type RepBreakdown = {
  userId: string;
  name: string;
  assigned: number;
  accepted: number;
  converted: number;
  dismissed: number;
};

export type TypeBreakdown = {
  accountType: string;
  label: string;
  total: number;
  unworked: number;
  converted: number;
};

export type SourceBreakdown = {
  source: string;
  sourceDetail: string | null;
  total: number;
  converted: number;
};

export type PenetrationData = {
  territoryId: string;
  territoryName: string;
  totalProspects: number;
  worked: number;
  unworked: number;
  converted: number;
  dismissed: number;
  queued: number;
  penetrationRate: number;
  conversionRate: number;
  repBreakdowns: RepBreakdown[];
  typeBreakdowns: TypeBreakdown[];
  sourceBreakdowns: SourceBreakdown[];
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

export default async function PenetrationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, userId } = await requireServerOrgContext();

  // Role gate
  const { data: orgUser } = await supabase
    .from("org_users")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (!orgUser || !["manager", "admin"].includes(orgUser.role)) {
    redirect("/app");
  }

  // Fetch territory
  const { data: territory } = await supabase
    .from("territories")
    .select("id,name")
    .eq("id", id)
    .maybeSingle();
  if (!territory) redirect("/app/manager/territories");

  // Fetch prospects + org users in parallel
  const [prospectsRes, orgUsersRes] = await Promise.all([
    supabase
      .from("prospects")
      .select("id,status,account_type,source,source_detail,created_at")
      .eq("territory_id", id),
    supabase
      .from("org_users")
      .select("user_id,full_name,email")
      .order("full_name"),
  ]);

  const prospects = prospectsRes.data ?? [];
  const prospectIds = prospects.map((p) => p.id as string);

  // Fetch suggested_outreach for these prospects (needs prospect IDs first)
  const { data: suggestedData } = prospectIds.length > 0
    ? await supabase
        .from("suggested_outreach")
        .select("id,user_id,status,prospect_id")
        .in("prospect_id", prospectIds)
    : { data: [] };

  const suggested = suggestedData ?? [];

  // Build org user lookup
  const userNameMap = new Map<string, string>();
  for (const u of orgUsersRes.data ?? []) {
    userNameMap.set(
      u.user_id as string,
      (u.full_name as string | null)?.trim() || (u.email as string | null)?.split("@")[0] || (u.user_id as string).slice(0, 8),
    );
  }

  // ── Main metrics ────────────────────────────────────────────────────────

  const totalProspects = prospects.length;
  const converted = prospects.filter((p) => p.status === "converted").length;
  const dismissed = prospects.filter((p) => p.status === "dismissed").length;
  const queued = prospects.filter((p) => p.status === "queued").length;
  const worked = converted; // "worked" = converted to a real account
  const unworked = prospects.filter((p) => p.status === "unworked").length;
  const penetrationRate = totalProspects > 0 ? Math.round((worked / totalProspects) * 100) : 0;
  const conversionRate = (converted + dismissed) > 0 ? Math.round((converted / (converted + dismissed)) * 100) : 0;

  // ── Rep breakdown ───────────────────────────────────────────────────────

  const repMap = new Map<string, { assigned: number; accepted: number; converted: number; dismissed: number }>();
  for (const s of suggested) {
    const uid = s.user_id as string;
    if (!repMap.has(uid)) repMap.set(uid, { assigned: 0, accepted: 0, converted: 0, dismissed: 0 });
    const entry = repMap.get(uid)!;
    entry.assigned++;
    if (s.status === "accepted") entry.accepted++;
    if (s.status === "converted") entry.converted++;
    if (s.status === "dismissed") entry.dismissed++;
  }

  const repBreakdowns: RepBreakdown[] = Array.from(repMap.entries())
    .map(([uid, stats]) => ({
      userId: uid,
      name: userNameMap.get(uid) ?? uid.slice(0, 8),
      ...stats,
    }))
    .sort((a, b) => b.converted - a.converted);

  // ── Account type breakdown ──────────────────────────────────────────────

  const typeMap = new Map<string, { total: number; unworked: number; converted: number }>();
  for (const p of prospects) {
    const at = (p.account_type as string | null) ?? "unknown";
    if (!typeMap.has(at)) typeMap.set(at, { total: 0, unworked: 0, converted: 0 });
    const entry = typeMap.get(at)!;
    entry.total++;
    if (p.status === "unworked") entry.unworked++;
    if (p.status === "converted") entry.converted++;
  }

  const typeBreakdowns: TypeBreakdown[] = Array.from(typeMap.entries())
    .map(([at, stats]) => ({
      accountType: at,
      label: TYPE_LABELS[at] ?? at,
      ...stats,
    }))
    .sort((a, b) => b.unworked - a.unworked);

  // ── Source breakdown ────────────────────────────────────────────────────

  const sourceKey = (s: string, sd: string | null) => `${s}||${sd ?? ""}`;
  const sourceMap = new Map<string, { source: string; sourceDetail: string | null; total: number; converted: number }>();
  for (const p of prospects) {
    const src = p.source as string;
    const sd = p.source_detail as string | null;
    const key = sourceKey(src, sd);
    if (!sourceMap.has(key)) sourceMap.set(key, { source: src, sourceDetail: sd, total: 0, converted: 0 });
    const entry = sourceMap.get(key)!;
    entry.total++;
    if (p.status === "converted") entry.converted++;
  }

  const sourceBreakdowns: SourceBreakdown[] = Array.from(sourceMap.values())
    .sort((a, b) => b.converted - a.converted);

  const data: PenetrationData = {
    territoryId: territory.id as string,
    territoryName: territory.name as string,
    totalProspects,
    worked,
    unworked,
    converted,
    dismissed,
    queued,
    penetrationRate,
    conversionRate,
    repBreakdowns,
    typeBreakdowns,
    sourceBreakdowns,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href={`/app/manager/territories/${id}`}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-500 hover:bg-slate-50"
        >
          Back
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Territory Penetration</h1>
          <p className="text-sm text-slate-500">{territory.name as string}</p>
        </div>
      </div>

      <PenetrationClient data={data} />
    </div>
  );
}
