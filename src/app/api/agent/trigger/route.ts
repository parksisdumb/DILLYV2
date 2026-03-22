import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";

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

    if (!user) {
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

    if (!orgUser || !["admin", "manager"].includes(orgUser.role)) {
      return NextResponse.json(
        { error: "Forbidden", detail: orgUserError?.message ?? `role=${orgUser?.role ?? "none"}` },
        { status: 403 }
      );
    }

    const orgId = orgUser.org_id as string;
    console.log("[agent/trigger] Sending Inngest event for org:", orgId);

    // Send Inngest event — the durable function handles everything
    await inngest.send({
      name: "app/prospecting-agent.run",
      data: {
        org_id: orgId,
        triggered_by: user.id,
      },
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
