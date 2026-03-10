import { NextRequest, NextResponse } from "next/server";

const ADMIN_SESSION_TOKEN = "dilly-admin-authenticated";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect /admin routes (except /admin/login and /admin/logout)
  if (
    pathname.startsWith("/admin") &&
    pathname !== "/admin/login" &&
    pathname !== "/admin/logout"
  ) {
    const sessionCookie = request.cookies.get("admin_session");
    if (!sessionCookie || sessionCookie.value !== ADMIN_SESSION_TOKEN) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
