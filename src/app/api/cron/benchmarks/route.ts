import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Calculate benchmarks for the last 30 days
  const periodEnd = new Date().toISOString().split("T")[0]; // today
  const periodStart = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0]; // 30 days ago

  const { data, error } = await supabase.rpc("rpc_calculate_benchmarks", {
    p_period_start: periodStart,
    p_period_end: periodEnd,
  });

  if (error) {
    console.error("Benchmark calculation failed:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    result: data,
  });
}
