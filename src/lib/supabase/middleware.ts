import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase session on every request and syncs the auth cookies
// between request and response. This is the REQUIRED @supabase/ssr middleware.
//
// Without it, a session cookie freshly written by the browser client (e.g. right
// after signInWithPassword) isn't reliably visible to Server Components — and the
// server client can't write a refreshed token from an RSC (its setAll is a no-op
// there). So /app reads no session and redirects to /login, producing "it said I
// logged in, but the UI never left the login screen." The race also causes random
// logouts as access tokens expire with nothing to refresh them.
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and getUser(). This call
  // validates/refreshes the token and, when it rotates, triggers setAll above to
  // write the refreshed cookies onto the response.
  await supabase.auth.getUser();

  return response;
}
