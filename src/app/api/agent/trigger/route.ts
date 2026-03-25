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

    // Accept optional agent type — defaults to prospect-discovery
    const body = await request.json().catch(() => ({}));
    const agentType = (body as { agent?: string }).agent ?? "prospect-discovery";

    let eventName: string;
    switch (agentType) {
      case "edgar":
        eventName = "app/edgar-intelligence.run";
        break;
      case "prospect-discovery":
        eventName = "app/prospect-discovery.run";
        break;
      case "distributor":
        eventName = "app/intel-distributor.run";
        break;
      default:
        eventName = "app/prospect-discovery.run";
    }

    console.log(`[agent/trigger] Firing ${agentType} agent (${eventName})`);

    await inngest.send({ name: eventName, data: {} });

    return NextResponse.json({ ok: true, agent: agentType });
  } catch (err) {
    console.error("[agent/trigger] Uncaught exception:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
