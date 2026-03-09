import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect /admin routes (except /admin/login)
  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    const adminSecret = process.env.ADMIN_SECRET_KEY;
    if (!adminSecret) {
      // If no secret is configured, block access entirely
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }

    const sessionCookie = request.cookies.get("admin_session");
    if (!sessionCookie || sessionCookie.value !== adminSecret) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
