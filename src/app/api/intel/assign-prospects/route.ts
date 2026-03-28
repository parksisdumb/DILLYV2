import { NextRequest, NextResponse } from "next/server";
import { requireServerOrgContext } from "@/lib/supabase/server-org";

export async function POST(req: NextRequest) {
  try {
    const { supabase, userId, orgId } = await requireServerOrgContext();

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
    const { prospect_ids, rep_user_id } = body as {
      prospect_ids: string[];
      rep_user_id: string;
    };

    if (!prospect_ids?.length || !rep_user_id) {
      return NextResponse.json(
        { error: "prospect_ids and rep_user_id required" },
        { status: 400 }
      );
    }

    let assigned = 0;

    for (const prospectId of prospect_ids) {
      // Get prospect confidence_score for rank_score
      const { data: prospect } = await supabase
        .from("prospects")
        .select("confidence_score")
        .eq("id", prospectId)
        .maybeSingle();

      const { error: insertErr } = await supabase
        .from("suggested_outreach")
        .insert({
          org_id: orgId,
          prospect_id: prospectId,
          user_id: rep_user_id,
          status: "new",
          rank_score: (prospect?.confidence_score as number) ?? 50,
          reason_codes: [
            { source: "manager_assigned", intel_score: prospect?.confidence_score },
          ],
          assigned_by: userId,
        });

      if (!insertErr) {
        assigned++;
      }
      // Silently skip duplicates (unique constraint on org+user+prospect)
    }

    return NextResponse.json({ assigned });
  } catch (err) {
    console.error("[assign-prospects]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
