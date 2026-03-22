import { NextResponse } from "next/server";

// Deprecated — prospecting agent now runs via Inngest durable functions.
// See src/inngest/functions/prospecting-agent.ts

export async function GET() {
  return NextResponse.json(
    { error: "Deprecated. Prospecting agent now runs via Inngest." },
    { status: 410 }
  );
}
