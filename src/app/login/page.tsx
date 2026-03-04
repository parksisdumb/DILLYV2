"use client";

// Never prerender at build time — this page reads search params and auth state
export const dynamic = "force-dynamic";

import { Suspense, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { useRouter, useSearchParams } from "next/navigation";

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
        setError(authError.message);
        return;
      }

      const requestedNext = searchParams.get("next");
      const nextPath =
        requestedNext && requestedNext.startsWith("/") ? requestedNext : "/app";

      router.push(nextPath);
      router.refresh();
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
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        disabled={loading}
      >
        {loading ? "..." : mode === "login" ? "Log in" : "Sign up"}
      </button>

      <button
        type="button"
        className="w-full text-center text-sm text-slate-500 hover:text-slate-700"
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
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
