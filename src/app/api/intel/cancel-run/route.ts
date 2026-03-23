import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    const userSupabase = await createClient();
    const {
      data: { user },
    } = await userSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: orgUser } = await userSupabase
      .from("org_users")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!orgUser || !["admin", "manager"].includes(orgUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const runId = body.run_id as string;

    if (!runId) {
      return NextResponse.json({ error: "run_id required" }, { status: 400 });
    }

    const admin = createAdminClient();
    await admin
      .from("agent_runs")
      .update({
        status: "failed",
        error_message: "Cancelled by user",
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("status", "running");

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[intel/cancel-run] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
