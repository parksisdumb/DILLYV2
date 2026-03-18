import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    // Verify the user is authenticated and is admin/manager
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
    console.log("[agent/trigger] orgUser:", orgUser);

    if (!orgUser || !["admin", "manager"].includes(orgUser.role)) {
      console.error("[agent/trigger] Forbidden — orgUser:", orgUser, "error:", orgUserError);
      return NextResponse.json(
        { error: "Forbidden", detail: orgUserError?.message ?? `role=${orgUser?.role ?? "none"}` },
        { status: 403 }
      );
    }

    const orgId = orgUser.org_id as string;
    console.log("[agent/trigger] orgId:", orgId, "role:", orgUser.role);

    // Check for already-running agent
    const adminSupabase = createAdminClient();
    const { data: running, error: runningError } = await adminSupabase
      .from("agent_runs")
      .select("id")
      .eq("org_id", orgId)
      .eq("status", "running")
      .limit(1);

    if (runningError) {
      console.error("[agent/trigger] agent_runs running check error:", runningError);
      return NextResponse.json(
        { error: "Failed to check running agents", detail: runningError.message },
        { status: 500 }
      );
    }

    if (running && running.length > 0) {
      console.log("[agent/trigger] Agent already running:", running[0].id);
      return NextResponse.json(
        { error: "Agent is already running", run_id: running[0].id },
        { status: 409 }
      );
    }

    // Create the agent run record
    const { data: agentRun, error: insertErr } = await adminSupabase
      .from("agent_runs")
      .insert({ org_id: orgId, run_type: "prospecting", status: "running" })
      .select("id")
      .single();

    if (insertErr) {
      console.error("[agent/trigger] agent_runs INSERT error:", JSON.stringify(insertErr, null, 2));
    }
    console.log("[agent/trigger] Insert result — data:", agentRun, "error:", insertErr);

    if (insertErr || !agentRun) {
      return NextResponse.json(
        {
          error: "Failed to create agent run",
          detail: insertErr?.message ?? "No data returned",
          code: insertErr?.code ?? "unknown",
          hint: insertErr?.hint ?? null,
        },
        { status: 500 }
      );
    }

    console.log("[agent/trigger] Agent run created:", agentRun.id);

    // Fire the cron endpoint in the background
    const cronSecret = process.env.CRON_SECRET;
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    console.log("[agent/trigger] Firing cron at:", `${appUrl}/api/cron/prospecting-agent`);

    // Non-blocking: trigger the cron and return immediately
    fetch(`${appUrl}/api/cron/prospecting-agent`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
      },
    }).catch((err) => {
      console.error("[agent/trigger] Failed to trigger prospecting agent:", err);
    });

    return NextResponse.json({ ok: true, run_id: agentRun.id });
  } catch (err) {
    console.error("[agent/trigger] Uncaught exception:", err);
    return NextResponse.json(
      {
        error: "Internal server error",
        detail: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      { status: 500 }
    );
  }
}
