import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  // Verify the user is authenticated and is admin/manager
  const userSupabase = await createClient();
  const {
    data: { user },
  } = await userSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check role
  const { data: orgUser } = await userSupabase
    .from("org_users")
    .select("org_id,role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!orgUser || !["admin", "manager"].includes(orgUser.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const orgId = orgUser.org_id as string;

  // Check for already-running agent
  const adminSupabase = createAdminClient();
  const { data: running } = await adminSupabase
    .from("agent_runs")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "running")
    .limit(1);

  if (running && running.length > 0) {
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

  if (insertErr || !agentRun) {
    return NextResponse.json(
      { error: "Failed to create agent run" },
      { status: 500 }
    );
  }

  // Fire the cron endpoint in the background
  const cronSecret = process.env.CRON_SECRET;
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // Non-blocking: trigger the cron and return immediately
  fetch(`${appUrl}/api/cron/prospecting-agent`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
    },
  }).catch((err) => {
    console.error("Failed to trigger prospecting agent:", err);
  });

  return NextResponse.json({ ok: true, run_id: agentRun.id });
}
