import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    console.log("[agent/trigger] Starting trigger request");
    const userSupabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await userSupabase.auth.getUser();

    if (authError) {
      console.error("[agent/trigger] Auth error:", authError);
    }
    console.log("[agent/trigger] User:", user?.id ?? "null", "authError:", authError?.message ?? "none");

    if (!user) {
      console.error("[agent/trigger] No user found, returning 401");
      return NextResponse.json(
        { error: "Unauthorized", detail: authError?.message ?? "No user session" },
        { status: 401 }
      );
    }

    // Check role
    const { data: orgUser, error: orgUserError } = await userSupabase
      .from("org_users")
      .select("org_id,role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (orgUserError) {
      console.error("[agent/trigger] org_users query error:", orgUserError);
    }

    if (!orgUser || !["admin", "manager"].includes(orgUser.role)) {
      console.error("[agent/trigger] Forbidden — orgUser:", orgUser, "error:", orgUserError);
      return NextResponse.json(
        { error: "Forbidden", detail: orgUserError?.message ?? `role=${orgUser?.role ?? "none"}` },
        { status: 403 }
      );
    }

    const orgId = orgUser.org_id as string;
    console.log("[agent/trigger] orgId:", orgId, "role:", orgUser.role);

    // Fire the cron endpoint in the background — it creates its own agent_runs record
    const cronSecret = process.env.CRON_SECRET;
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    console.log("[agent/trigger] Firing cron at:", `${appUrl}/api/cron/prospecting-agent`);

    fetch(`${appUrl}/api/cron/prospecting-agent`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
      },
    }).catch((err) => {
      console.error("[agent/trigger] Failed to trigger prospecting agent:", err);
    });

    return NextResponse.json({ ok: true, org_id: orgId });
  } catch (err) {
    console.error("[agent/trigger] Uncaught exception:", err);
    return NextResponse.json(
      {
        error: "Internal server error",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
