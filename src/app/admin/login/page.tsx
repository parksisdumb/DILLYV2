"use client";

import { useState } from "react";

export default function AdminLoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const password = form.get("password");

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        // 401 = wrong secret; anything else is an unexpected server error.
        setError(res.status === 401 ? "Incorrect secret key." : "Something went wrong — please try again.");
        setLoading(false);
        return;
      }

      const { token } = await res.json();

      // Set cookie directly from the browser — bypasses all server-side cookie issues
      const secure = location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `admin_session=${token}; Path=/; Max-Age=86400; SameSite=Lax${secure}`;

      // Full page navigation to /admin (not client-side routing)
      window.location.href = "/admin";
    } catch {
      // Network failure or unexpected exception — never fail silently.
      setError("Something went wrong — please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-2xl font-bold tracking-tight text-blue-400">Dilly</div>
          <div className="mt-1 text-sm text-slate-500">Internal Admin Portal</div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="w-full rounded-2xl border border-slate-700 bg-slate-800 p-8 shadow-sm space-y-5"
        >
          <h1 className="text-lg font-semibold text-white">Admin Access</h1>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-300">Secret Key</label>
            <input
              className="w-full rounded-xl border border-slate-600 bg-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              name="password"
              type="password"
              autoComplete="off"
              placeholder="Enter admin secret key"
              required
            />
          </div>

          {error && (
            <p
              role="alert"
              aria-live="assertive"
              className="rounded-xl border border-red-800 bg-red-900/50 px-3 py-2 text-sm font-medium text-red-300"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading && (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
