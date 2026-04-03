import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export async function POST(req: NextRequest) {
  try {
    const { event } = (await req.json()) as { event: string };

    if (!event) {
      return NextResponse.json({ error: "event required" }, { status: 400 });
    }

    // Validate event name
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
