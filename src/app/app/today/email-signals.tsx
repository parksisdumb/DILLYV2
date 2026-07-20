"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

// Follow-up nudges derived from synced Gmail metadata (see synced_emails).
// Two mutually-exclusive signals per contact:
//   • awaiting_reply — my latest email got no reply and it's been >= N days.
//   • they_replied   — they replied and I haven't answered in >= 2 days.

const AWAITING_DAYS = 4;
const REPLIED_DAYS = 2;
const LOOKBACK_MS = 45 * 86_400_000;
const DAY_MS = 86_400_000;

type SyncedRow = {
  matched_contact_id: string | null;
  direction: "inbound" | "outbound";
  subject: string | null;
  message_ts: string;
};

type Signal = {
  contactId: string;
  contactName: string;
  accountId: string;
  kind: "awaiting_reply" | "they_replied";
  subject: string | null;
  days: number;
};

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
}

export default function EmailSignals() {
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [emailTypeId, setEmailTypeId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const cutoff = new Date(Date.now() - LOOKBACK_MS).toISOString();

    const [emailsRes, typeRes] = await Promise.all([
      // RLS scopes synced_emails to the current user.
      supabase
        .from("synced_emails")
        .select("matched_contact_id,direction,subject,message_ts")
        .gte("message_ts", cutoff)
        .order("message_ts", { ascending: true }),
      supabase.from("touchpoint_types").select("id,key,org_id").eq("key", "email"),
    ]);

    const rows = (emailsRes.data ?? []) as SyncedRow[];

    // Resolve the email touchpoint type (prefer org-specific over global).
    const types = (typeRes.data ?? []) as { id: string; org_id: string | null }[];
    const emailType = types.find((t) => t.org_id) ?? types[0] ?? null;
    setEmailTypeId(emailType?.id ?? null);

    // Aggregate latest inbound/outbound per contact.
    type Agg = { lastOut: SyncedRow | null; lastIn: SyncedRow | null };
    const byContact = new Map<string, Agg>();
    for (const r of rows) {
      if (!r.matched_contact_id) continue;
      const agg = byContact.get(r.matched_contact_id) ?? { lastOut: null, lastIn: null };
      if (r.direction === "outbound") agg.lastOut = r;
      else agg.lastIn = r;
      byContact.set(r.matched_contact_id, agg);
    }

    const contactIds = [...byContact.keys()];
    if (contactIds.length === 0) {
      setSignals([]);
      return;
    }

    const { data: contacts } = await supabase
      .from("contacts")
      .select("id,full_name,account_id")
      .in("id", contactIds)
      .is("deleted_at", null);
    const contactById = new Map(
      (contacts ?? []).map((c) => [
        c.id as string,
        { name: (c.full_name as string | null) ?? "Contact", accountId: c.account_id as string },
      ]),
    );

    const out: Signal[] = [];
    for (const [contactId, agg] of byContact) {
      const c = contactById.get(contactId);
      if (!c) continue;
      const outTs = agg.lastOut ? new Date(agg.lastOut.message_ts).getTime() : 0;
      const inTs = agg.lastIn ? new Date(agg.lastIn.message_ts).getTime() : 0;

      if (agg.lastIn && inTs > outTs && daysAgo(agg.lastIn.message_ts) >= REPLIED_DAYS) {
        out.push({
          contactId,
          contactName: c.name,
          accountId: c.accountId,
          kind: "they_replied",
          subject: agg.lastIn.subject,
          days: daysAgo(agg.lastIn.message_ts),
        });
      } else if (agg.lastOut && inTs <= outTs && daysAgo(agg.lastOut.message_ts) >= AWAITING_DAYS) {
        out.push({
          contactId,
          contactName: c.name,
          accountId: c.accountId,
          kind: "awaiting_reply",
          subject: agg.lastOut.subject,
          days: daysAgo(agg.lastOut.message_ts),
        });
      }
    }

    // "They replied" first (more urgent), then longest-waiting.
    out.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "they_replied" ? -1 : 1;
      return b.days - a.days;
    });
    setSignals(out);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function logFollowUp(s: Signal) {
    if (!emailTypeId) return;
    setBusyId(s.contactId);
    try {
      // Hand-logged follow-up → goes through the normal rep-authenticated RPC, so
      // it DOES score (unlike the visibility-only synced emails).
      const { error } = await supabase.rpc("rpc_log_outreach_touchpoint", {
        p_contact_id: s.contactId,
        p_account_id: s.accountId,
        p_touchpoint_type_id: emailTypeId,
        p_notes: s.subject ? `Follow-up on: ${s.subject}` : "Email follow-up",
        p_engagement_phase: "follow_up",
      });
      if (!error) {
        setDismissed((prev) => new Set(prev).add(s.contactId));
      }
    } finally {
      setBusyId(null);
    }
  }

  const visible = signals.filter((s) => !dismissed.has(s.contactId)).slice(0, 6);
  if (visible.length === 0) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">Email follow-ups</h2>
      <div className="space-y-2">
        {visible.map((s) => {
          const replied = s.kind === "they_replied";
          return (
            <div
              key={s.contactId}
              className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${
                replied ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  <a href={`/app/contacts/${s.contactId}`} className="hover:underline">
                    {s.contactName}
                  </a>
                  {" — "}
                  <span className={replied ? "text-emerald-700" : "text-amber-700"}>
                    {replied
                      ? "They replied — respond"
                      : `Awaiting reply — sent ${s.days} day${s.days === 1 ? "" : "s"} ago`}
                  </span>
                </p>
                {s.subject && <p className="truncate text-xs text-slate-500">{s.subject}</p>}
              </div>
              <button
                type="button"
                disabled={busyId === s.contactId || !emailTypeId}
                onClick={() => void logFollowUp(s)}
                className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busyId === s.contactId ? "Logging…" : "Log follow-up"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
