"use client";

// Never prerender at build time — this page reads search params and auth state
export const dynamic = "force-dynamic";

import { Suspense, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { useRouter, useSearchParams } from "next/navigation";

// Map Supabase auth errors to rep-friendly messages. Bad creds get a clear
// "Incorrect email or password"; anything unrecognized falls back to a generic
// message so a failure is never silent.
function friendlyAuthError(
  err: { message?: string; code?: string; status?: number } | null | undefined,
  mode: "login" | "signup",
): string {
  const msg = (err?.message ?? "").toLowerCase();
  const code = err?.code ?? "";

  if (
    code === "invalid_credentials" ||
    msg.includes("invalid login credentials") ||
    msg.includes("invalid credentials")
  ) {
    return "Incorrect email or password.";
  }
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) {
    return "Please confirm your email address, then log in.";
  }
  if (err?.status === 429 || code === "over_request_rate_limit" || msg.includes("rate limit")) {
    return "Too many attempts — please wait a moment and try again.";
  }
  if (
    mode === "signup" &&
    (code === "user_already_exists" || msg.includes("already registered") || msg.includes("already exists"))
  ) {
    return "An account with this email already exists — try logging in instead.";
  }
  return "Something went wrong — please try again.";
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Create client inside the handler so it's never called during SSR prerender
      const supabase = createBrowserSupabase();

      const { error: authError } =
        mode === "login"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });

      if (authError) {
        setError(friendlyAuthError(authError, mode));
        return;
      }

      const requestedNext = searchParams.get("next");
      const nextPath =
        requestedNext && requestedNext.startsWith("/") ? requestedNext : "/app";

      router.push(nextPath);
      router.refresh();
    } catch {
      // Network failure, misconfigured client, or any unexpected exception —
      // signInWithPassword throws rather than returning {error} here, so without
      // this catch the failure was silent.
      setError("Something went wrong — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm space-y-5"
    >
      <h1 className="text-lg font-semibold text-slate-900">
        {mode === "login" ? "Log in" : "Create account"}
      </h1>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Email</label>
        <input
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          autoComplete="email"
          required
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Password</label>
        <input
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
        />
      </div>

      {error && (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={loading}
      >
        {loading && (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        )}
        {loading
          ? mode === "login"
            ? "Logging in…"
            : "Signing up…"
          : mode === "login"
            ? "Log in"
            : "Sign up"}
      </button>

      <button
        type="button"
        disabled={loading}
        className="w-full text-center text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
        onClick={() => {
          setError(null);
          setMode(mode === "login" ? "signup" : "login");
        }}
      >
        {mode === "login"
          ? "Need an account? Sign up"
          : "Already have an account? Log in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-2xl font-bold tracking-tight text-blue-600">Dilly</div>
          <div className="mt-1 text-sm text-slate-500">Commercial Roofing BD OS</div>
        </div>

        {/* Suspense required by Next.js for useSearchParams() */}
        <Suspense
          fallback={
            <div className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm" />
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
