import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "crypto";

export function adminToken(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export async function requireAdmin() {
  const cookieStore = await cookies();
  const session = cookieStore.get("admin_session")?.value;
  const adminSecret = process.env.ADMIN_SECRET_KEY;

  console.log("[admin-auth]", {
    hasCookie: !!session,
    cookieLen: session?.length,
    hasSecret: !!adminSecret,
    match: !!adminSecret && session === adminToken(adminSecret),
  });

  if (!adminSecret || session !== adminToken(adminSecret)) {
    redirect("/admin/login");
  }
}
