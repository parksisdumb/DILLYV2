import { NextRequest, NextResponse } from "next/server";
import { requireServerOrgContext } from "@/lib/supabase/server-org";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProvider } from "@/lib/email";
import { decryptToken } from "@/lib/email/crypto";

export const runtime = "nodejs";

// Revokes the Gmail grant with Google and clears stored tokens.
export async function POST(req: NextRequest) {
  const { userId } = await requireServerOrgContext();
  const admin = createAdminClient();

  const { data: conn } = await admin
    .from("email_connections")
    .select("refresh_token_enc")
    .eq("user_id", userId)
    .eq("provider", "gmail")
    .maybeSingle();

  const enc = conn?.refresh_token_enc as string | null | undefined;
  if (enc) {
    try {
      await getProvider("gmail").revoke(decryptToken(enc));
    } catch {
      // Best-effort revoke — clear our copy regardless.
    }
  }

  await admin
    .from("email_connections")
    .update({
      status: "revoked",
      access_token_enc: null,
      refresh_token_enc: null,
      history_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", "gmail");

  return NextResponse.redirect(new URL("/app/settings?gmail_disconnected=1", req.nextUrl.origin));
}
