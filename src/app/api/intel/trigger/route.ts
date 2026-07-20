import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { isAdminSession } from "@/lib/admin-auth";

// Fires a backend intel agent. Gated so it can NEVER run unauthenticated:
//   - the platform-admin console (its only in-app caller) sends the admin_session
//     cookie automatically (same-origin), or
//   - a server-to-server caller supplies the x-dilly-intel-secret header
//     (same shared secret /api/intel/receive uses).
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-dilly-intel-secret");
  const secretOk = Boolean(
    process.env.DILLY_INTEL_SECRET && secret === process.env.DILLY_INTEL_SECRET,
  );
  const adminOk = await isAdminSession();
  if (!secretOk && !adminOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { event } = (await req.json()) as { event: string };

    if (!event) {
      return NextResponse.json({ error: "event required" }, { status: 400 });
    }

    // Only the live agents are triggerable.
    const allowed = [
      "app/edgar-intelligence.run",
      "app/prospect-discovery.run",
      "app/enrichment-agent.run",
      "app/intel-distributor.run",
    ];

    if (!allowed.includes(event)) {
      return NextResponse.json({ error: "unknown event" }, { status: 400 });
    }

    await inngest.send({ name: event, data: {} });
    return NextResponse.json({ ok: true, event });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
