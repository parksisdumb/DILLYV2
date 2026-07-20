import { NextRequest, NextResponse } from "next/server";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest } from "@/inngest/client";
import { getProvider, gmailRedirectUri } from "@/lib/email";
import { verifyState } from "@/lib/email/oauth-state";
import { encryptToken } from "@/lib/email/crypto";

export const runtime = "nodejs";

// Google redirects here after consent. Verifies state, exchanges the code,
// encrypts + stores tokens, and kicks an immediate first sync.
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const settingsUrl = new URL("/app/settings", origin);
  const fail = (reason: string) => {
    settingsUrl.searchParams.set("gmail_error", reason);
    return NextResponse.redirect(settingsUrl);
  };

  try {
    const params = req.nextUrl.searchParams;
    if (params.get("error")) return fail(params.get("error") as string);

    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) return fail("missing_code");

    const { userId, orgId } = await requireServerOrgContext();

    const verified = verifyState(state);
    if (!verified || verified.userId !== userId) return fail("bad_state");

    const provider = getProvider("gmail");
    const tokens = await provider.exchangeCode({ code, redirectUri: gmailRedirectUri(origin) });
    if (!tokens.refreshToken) {
      // No refresh token → we can't sync in the background. User likely re-consented
      // without prompt=consent; ask them to reconnect.
      return fail("no_refresh_token");
    }

    const profile = await provider.getProfile(tokens.accessToken);

    const admin = createAdminClient();
    const { error } = await admin.from("email_connections").upsert(
      {
        org_id: orgId,
        user_id: userId,
        provider: "gmail",
        email_address: profile.emailAddress,
        access_token_enc: encryptToken(tokens.accessToken),
        refresh_token_enc: encryptToken(tokens.refreshToken),
        token_expires_at: tokens.expiresAt,
        history_id: null, // null → first sync does the 30-day backfill
        status: "active",
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    );
    if (error) return fail("store_failed");

    await inngest.send({ name: "app/gmail.sync.user", data: { userId } });

    settingsUrl.searchParams.set("gmail_connected", "1");
    return NextResponse.redirect(settingsUrl);
  } catch {
    return fail("exception");
  }
}
