"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { Suspense } from "react";

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function handleCallback() {
      const supabase = createBrowserSupabase();
      const next = searchParams.get("next") ?? "/app";
      const safePath = next.startsWith("/") ? next : "/app";

      // Case 1: PKCE flow — code in query params
      const code = searchParams.get("code");
      if (code) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code);
        if (!exchangeError) {
          router.push(safePath);
          router.refresh();
          return;
        }
        setError(exchangeError.message);
        return;
      }

      // Case 2: Implicit flow — tokens in URL hash fragment
      // Supabase client auto-detects hash fragments on initialization,
      // so we just need to check if a session exists after a short wait.
      const hash = window.location.hash;
      if (hash && hash.includes("access_token")) {
        // Give the Supabase client a moment to pick up the hash tokens
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (session && !sessionError) {
          router.push(safePath);
          router.refresh();
          return;
        }
        setError(sessionError?.message ?? "Failed to establish session from invite link.");
        return;
      }

      // Case 3: No code or hash — check if already authenticated
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        router.push(safePath);
        router.refresh();
        return;
      }

      setError("No authentication code found. The link may have expired.");
    }

    handleCallback();
  }, [router, searchParams]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm space-y-4">
          <h1 className="text-lg font-semibold text-slate-900">Authentication Error</h1>
          <p className="text-sm text-red-600">{error}</p>
          <a
            href="/login"
            className="block w-full rounded-xl bg-blue-600 py-2.5 text-center text-sm font-semibold text-white hover:bg-blue-700"
          >
            Go to login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="text-sm text-slate-500">Setting up your account...</div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
          <div className="text-sm text-slate-500">Loading...</div>
        </div>
      }
    >
      <CallbackHandler />
    </Suspense>
  );
}
