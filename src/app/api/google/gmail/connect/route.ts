import { NextRequest, NextResponse } from "next/server";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import { getProvider, gmailRedirectUri } from "@/lib/email";
import { signState } from "@/lib/email/oauth-state";

export const runtime = "nodejs";

// Kicks off the Gmail OAuth consent flow for the current user.
export async function GET(req: NextRequest) {
  const { userId } = await requireServerOrgContext();
  const redirectUri = gmailRedirectUri(req.nextUrl.origin);
  const url = getProvider("gmail").getAuthUrl({ redirectUri, state: signState(userId) });
  return NextResponse.redirect(url);
}
