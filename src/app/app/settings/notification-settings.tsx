"use client";

import { useState, useTransition } from "react";
import { setFollowUpDigestPref, sendMyDigestTest } from "./actions";

export function NotificationSettings({
  initialEnabled,
  isAdmin,
}: {
  initialEnabled: boolean;
  isAdmin: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [toggleMsg, setToggleMsg] = useState<string | null>(null);
  const [toggleErr, setToggleErr] = useState<string | null>(null);
  const [savingPref, startSaving] = useTransition();

  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testErr, setTestErr] = useState<string | null>(null);
  const [sending, startSending] = useTransition();

  function toggle() {
    const next = !enabled;
    setEnabled(next); // optimistic
    setToggleMsg(null);
    setToggleErr(null);
    startSaving(async () => {
      const res = await setFollowUpDigestPref(next);
      if (res.ok) {
        setToggleMsg(res.message ?? "Saved.");
      } else {
        setEnabled(!next); // revert
        setToggleErr(res.error ?? "Couldn't save.");
      }
    });
  }

  function sendTest() {
    setTestMsg(null);
    setTestErr(null);
    startSending(async () => {
      const res = await sendMyDigestTest();
      if (res.ok) setTestMsg(res.message ?? "Sent.");
      else setTestErr(res.error ?? "Send failed.");
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-800">Follow-up morning digest</h2>
      <p className="mt-1 text-sm text-slate-500">
        A 7:00 AM email with your follow-ups due today, anything overdue, and accounts going cold — so nothing slips
        while you’re in the field.
      </p>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800">Send me the morning digest</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Overdue items still escalate to your manager even if this is off.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={toggle}
          disabled={savingPref}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-60 ${
            enabled ? "bg-blue-600" : "bg-slate-300"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
              enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
      {toggleMsg && <p className="mt-2 text-xs text-green-700">{toggleMsg}</p>}
      {toggleErr && <p className="mt-2 text-xs text-red-600">{toggleErr}</p>}

      {isAdmin && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="text-sm font-medium text-slate-800">Test send</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Send yourself your digest right now to verify formatting. Doesn’t affect the daily send.
          </p>
          <button
            type="button"
            onClick={sendTest}
            disabled={sending}
            className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {sending ? "Sending…" : "Send me my digest now"}
          </button>
          {testMsg && <p className="mt-2 text-xs text-green-700">{testMsg}</p>}
          {testErr && <p className="mt-2 text-xs text-red-600">{testErr}</p>}
        </div>
      )}
    </div>
  );
}
