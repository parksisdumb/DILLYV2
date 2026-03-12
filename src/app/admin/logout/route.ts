import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/admin/login", request.url));
  response.cookies.set("admin_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
