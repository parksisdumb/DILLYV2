import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";

export async function POST(request: NextRequest) {
  try {
    const userSupabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await userSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized", detail: authError?.message ?? "No user session" },
        { status: 401 }
      );
    }

    const { data: orgUser } = await userSupabase
      .from("org_users")
      .select("org_id,role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!orgUser || !["admin", "manager"].includes(orgUser.role)) {
      return NextResponse.json(
        { error: "Forbidden", detail: `role=${orgUser?.role ?? "none"}` },
        { status: 403 }
      );
    }

    const orgId = orgUser.org_id as string;
    console.log("[intel/distribute] Running distribution for org:", orgId);

    await inngest.send({
      name: "app/intel-distributor.run",
      data: { org_id: orgId },
    });

    return NextResponse.json({ ok: true, org_id: orgId });
  } catch (err) {
    console.error("[intel/distribute] Error:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
