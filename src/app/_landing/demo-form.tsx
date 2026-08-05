"use client";

import { useState } from "react";
import { submitDemoRequest } from "./actions";

// "Get a demo" form. Posts to the submitDemoRequest server action, which writes
// via the service-role admin client. Includes a hidden honeypot field ("website").
export function DemoForm() {
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "submitting") return;
    setStatus("submitting");
    setError(null);
    const form = e.currentTarget;
    const res = await submitDemoRequest(new FormData(form));
    if (res.ok) {
      setStatus("done");
      form.reset();
    } else {
      setStatus("error");
      setError(res.error ?? "Something went wrong — please try again.");
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-white">
          <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
            <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="text-lg font-semibold text-white">You’re on the list.</div>
        <p className="mt-1 text-sm text-slate-300">We’ll reach out to set up your demo shortly.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {/* Honeypot — visually hidden, off-screen, not tabbable. Bots fill it. */}
      <div className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden" aria-hidden="true">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <input
          name="name"
          required
          autoComplete="name"
          placeholder="Your name"
          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white placeholder:text-slate-500 outline-none transition focus:border-blue-500 focus:bg-white/[0.06]"
        />
        <input
          name="company"
          autoComplete="organization"
          placeholder="Company"
          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white placeholder:text-slate-500 outline-none transition focus:border-blue-500 focus:bg-white/[0.06]"
        />
      </div>
      <input
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="Work email"
        className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white placeholder:text-slate-500 outline-none transition focus:border-blue-500 focus:bg-white/[0.06]"
      />

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="w-full rounded-xl bg-blue-600 px-5 py-3 text-center text-base font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {status === "submitting" ? "Sending…" : "Get a demo"}
      </button>
      <p className="text-center text-xs text-slate-500">No spam. We’ll only use this to set up your demo.</p>
    </form>
  );
}
