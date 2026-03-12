import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/admin")) return NextResponse.next();
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) return NextResponse.next();
  if (pathname.startsWith("/admin/logout")) return NextResponse.next();

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
