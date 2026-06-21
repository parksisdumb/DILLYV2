"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

// Operational dispatch control: which reps are responsible for working a property.
// Writes go straight to property_assignments (existing table); RLS enforces that
// only managers/admins (or the creator) can write — this UI gates on canManage too.
// This is a label only; it does not change any read access.

type Member = { userId: string; name: string };

function nameOf(full_name: string | null, email: string | null, userId: string): string {
  return full_name?.trim() || email?.split("@")[0] || userId.slice(0, 8);
}

export default function PropertyAssignments({
  propertyId,
  orgId,
  canManage,
  currentUserId,
}: {
  propertyId: string;
  orgId: string;
  canManage: boolean;
  currentUserId: string;
}) {
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [paRes, ouRes] = await Promise.all([
        supabase.from("property_assignments").select("user_id").eq("property_id", propertyId),
        supabase.from("org_users").select("user_id,full_name,email,role").order("full_name"),
      ]);
      if (cancelled) return;
      setAssignedIds(new Set(((paRes.data ?? []) as { user_id: string }[]).map((r) => r.user_id)));
      setMembers(
        ((ouRes.data ?? []) as { user_id: string; full_name: string | null; email: string | null }[]).map((u) => ({
          userId: u.user_id,
          name: nameOf(u.full_name, u.email, u.user_id),
        })),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, propertyId]);

  const nameById = useMemo(() => new Map(members.map((m) => [m.userId, m.name])), [members]);
  const assignedList = useMemo(
    () => [...assignedIds].map((id) => ({ userId: id, name: nameById.get(id) ?? id.slice(0, 8) })).sort((a, b) => a.name.localeCompare(b.name)),
    [assignedIds, nameById],
  );

  async function assign(userId: string) {
    setBusyId(userId);
    const { error } = await supabase
      .from("property_assignments")
      .upsert(
        { property_id: propertyId, user_id: userId, org_id: orgId, assignment_role: "assigned_rep", created_by: currentUserId },
        { onConflict: "property_id,user_id", ignoreDuplicates: true },
      );
    setBusyId(null);
    if (!error) setAssignedIds((prev) => new Set(prev).add(userId));
  }

  async function unassign(userId: string) {
    setBusyId(userId);
    const { error } = await supabase
      .from("property_assignments")
      .delete()
      .eq("property_id", propertyId)
      .eq("user_id", userId);
    setBusyId(null);
    if (!error)
      setAssignedIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">Assigned Reps</h2>
        {canManage && !loading && (
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            {picking ? "Done" : "Assign Rep"}
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : assignedList.length === 0 ? (
        <p className="text-sm text-slate-500">No reps assigned</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {assignedList.map((a) => (
            <span
              key={a.userId}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
            >
              {a.name}
              {canManage && (
                <button
                  type="button"
                  disabled={busyId === a.userId}
                  onClick={() => void unassign(a.userId)}
                  className="text-slate-400 hover:text-red-600 disabled:opacity-50"
                  aria-label={`Unassign ${a.name}`}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Multi-select picker (managers/admins) */}
      {canManage && picking && (
        <div className="mt-3 max-h-56 space-y-0.5 overflow-y-auto rounded-xl border border-slate-200 p-2">
          {members.map((m) => {
            const on = assignedIds.has(m.userId);
            return (
              <label
                key={m.userId}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busyId === m.userId}
                  onChange={() => void (on ? unassign(m.userId) : assign(m.userId))}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-slate-700">{m.name}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
