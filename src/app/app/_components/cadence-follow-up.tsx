"use client";

// Shared follow-up cadence controls, used by every touchpoint-logging surface
// (contact / account / property detail panels) so behavior matches Grow exactly:
// follow-up defaults ON, the cadence date + note pre-fill per outcome, manual
// edits lock, and the created next_action links back to its source touchpoint.
//
// All cadence values live in @/lib/constants/cadence — tune there, not here.

import { useState } from "react";
import {
  cadenceFor,
  cadenceDueDateString,
  isInspectionOutcome,
  dayAfter,
} from "@/lib/constants/cadence";

const FIELD =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none";

function localDateStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export type FollowUpInsertCtx = {
  orgId: string;
  userId: string;
  contactId: string | null;
  accountId: string | null;
  propertyId?: string | null;
  typeId?: string | null;
  touchpointId?: string | null;
  fallbackNote?: string;
};

export type CadenceFollowUp = {
  on: boolean;
  date: string;
  notes: string;
  inspectionDate: string;
  outcomeKey: string | null;
  /** Call when the rep selects/deselects an outcome (pass its key, or null). */
  applyOutcome: (key: string | null) => void;
  onToggle: () => void;
  onEditDate: (v: string) => void;
  onEditNotes: (v: string) => void;
  onEditInspectionDate: (v: string) => void;
  reset: () => void;
  /**
   * Build the next_actions insert row, or null when nothing should be created
   * (follow-up off, or missing contact/account which next_actions requires).
   */
  buildInsert: (ctx: FollowUpInsertCtx) => Record<string, unknown> | null;
};

export function useCadenceFollowUp(): CadenceFollowUp {
  // Defaults ON — disciplined follow-up is the point; opting out is a conscious act.
  const [on, setOn] = useState(true);
  const [touched, setTouched] = useState(false);
  const [date, setDate] = useState(localDateStr(1));
  const [notes, setNotes] = useState("");
  const [inspectionDate, setInspectionDate] = useState("");
  const [outcomeKey, setOutcomeKey] = useState<string | null>(null);

  function applyOutcome(key: string | null) {
    setOutcomeKey(key);
    if (touched) return;
    const rule = cadenceFor(key);
    if (!rule) {
      setOn(false); // terminal outcome — no follow-up
      return;
    }
    setOn(true);
    setNotes(rule.note);
    if (isInspectionOutcome(key) && inspectionDate) {
      setDate(dayAfter(inspectionDate));
    } else {
      const ds = cadenceDueDateString(key);
      if (ds) setDate(ds);
    }
  }

  return {
    on,
    date,
    notes,
    inspectionDate,
    outcomeKey,
    applyOutcome,
    onToggle: () => {
      setOn((v) => !v);
      setTouched(true);
    },
    onEditDate: (v) => {
      setDate(v);
      setTouched(true);
    },
    onEditNotes: (v) => {
      setNotes(v);
      setTouched(true);
    },
    onEditInspectionDate: (v) => {
      setInspectionDate(v);
      // The inspection date drives the due date (day after) until the rep edits it.
      if (!touched && v) setDate(dayAfter(v));
    },
    reset: () => {
      setOn(true);
      setTouched(false);
      setDate(localDateStr(1));
      setNotes("");
      setInspectionDate("");
      setOutcomeKey(null);
    },
    buildInsert: (ctx) => {
      if (!on) return null;
      if (!ctx.contactId || !ctx.accountId) return null; // next_actions requires both
      return {
        org_id: ctx.orgId,
        assigned_user_id: ctx.userId,
        contact_id: ctx.contactId,
        account_id: ctx.accountId,
        property_id: ctx.propertyId ?? null,
        status: "open",
        due_at: new Date(`${date}T09:00:00`).toISOString(),
        notes: notes.trim() || ctx.fallbackNote || "Follow up",
        recommended_touchpoint_type_id: ctx.typeId ?? null,
        created_from_touchpoint_id: ctx.touchpointId ?? null,
        created_by: ctx.userId,
      };
    },
  };
}

export function CadenceFollowUpFields({ fu }: { fu: CadenceFollowUp }) {
  const showInspection = isInspectionOutcome(fu.outcomeKey);
  return (
    <div>
      <button type="button" onClick={fu.onToggle} className="flex items-center gap-3">
        <div
          className={[
            "relative h-5 w-9 rounded-full transition-colors",
            fu.on ? "bg-blue-600" : "bg-slate-200",
          ].join(" ")}
        >
          <div
            className={[
              "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
              fu.on ? "translate-x-4" : "translate-x-0.5",
            ].join(" ")}
          />
        </div>
        <span className="text-sm text-slate-700">Schedule follow-up</span>
      </button>

      {fu.on && (
        <div className="mt-3 space-y-2">
          {showInspection && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Inspection date</span>
              <input
                type="date"
                className={FIELD}
                value={fu.inspectionDate}
                onChange={(e) => fu.onEditInspectionDate(e.target.value)}
              />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Next touch</span>
            <input
              type="date"
              className={FIELD}
              value={fu.date}
              onChange={(e) => fu.onEditDate(e.target.value)}
            />
          </label>
          <input
            className={FIELD}
            placeholder="Follow-up notes (optional)"
            value={fu.notes}
            onChange={(e) => fu.onEditNotes(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
