import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Run on every page route so the session stays fresh and cookies sync — which is
  // what lets /app see the session right after login. Skip Next internals, static
  // assets, and /api (Inngest/cron/OAuth handlers manage their own auth and must
  // receive the raw request untouched).
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
