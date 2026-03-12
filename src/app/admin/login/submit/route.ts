import { NextRequest, NextResponse } from "next/server";

// Redirect to login page — login is now handled via Server Action
export async function POST(request: NextRequest) {
  return NextResponse.redirect(new URL("/admin/login", request.url), 303);
}
