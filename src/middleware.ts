import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only handle /admin routes
  if (!pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  // Allow login page and submit route through always
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) {
    return NextResponse.next();
  }

  // Allow logout through always
  if (pathname.startsWith("/admin/logout")) {
    return NextResponse.next();
  }

  // Check cookie
  const session = request.cookies.get("admin_session");
  const adminSecret = process.env.ADMIN_SECRET_KEY;

  if (!adminSecret || !session || session.value !== adminSecret) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/admin/:path*",
};
