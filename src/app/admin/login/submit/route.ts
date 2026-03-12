import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const password = String(formData.get("password") ?? "").trim();
  const adminSecret = process.env.ADMIN_SECRET_KEY;

  if (!adminSecret || password !== adminSecret) {
    return NextResponse.redirect(new URL("/admin/login?error=1", request.url), 303);
  }

  // Return a 200 HTML page that sets the cookie and redirects via meta refresh.
  // This avoids Set-Cookie on a 303 redirect, which Vercel's edge may strip.
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookieHeader = `admin_session=${adminSecret}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=86400`;

  const html = `<!DOCTYPE html>
<html><head>
<meta http-equiv="refresh" content="0;url=/admin">
</head><body><p>Redirecting...</p></body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html",
      "Set-Cookie": cookieHeader,
    },
  });
}
