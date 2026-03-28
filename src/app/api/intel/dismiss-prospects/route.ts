import { NextRequest, NextResponse } from "next/server";
import { requireServerOrgContext } from "@/lib/supabase/server-org";

export async function POST(req: NextRequest) {
  try {
    const { supabase, userId } = await requireServerOrgContext();

    // Verify manager/admin role
    const { data: orgUser } = await supabase
      .from("org_users")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();

    if (!orgUser || !["manager", "admin"].includes(orgUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { prospect_ids } = body as { prospect_ids: string[] };

    if (!prospect_ids?.length) {
      return NextResponse.json(
        { error: "prospect_ids required" },
        { status: 400 }
      );
    }

    // Mark prospects as dismissed by setting status
    const { error } = await supabase
      .from("prospects")
      .update({ status: "dismissed" })
      .in("id", prospect_ids);

    if (error) {
      console.error("[dismiss-prospects]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ dismissed: prospect_ids.length });
  } catch (err) {
    console.error("[dismiss-prospects]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
