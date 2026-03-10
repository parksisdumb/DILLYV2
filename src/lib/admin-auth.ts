import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Call at the top of every protected /admin server component.
 * Redirects to /admin/login if the session cookie is missing or invalid.
 */
export async function requireAdminAuth() {
  const adminSecret = process.env.ADMIN_SECRET_KEY;
  if (!adminSecret) {
    redirect("/admin/login");
  }
  const cookieStore = await cookies();
  const session = cookieStore.get("admin_session");
  if (!session || session.value !== adminSecret) {
    redirect("/admin/login");
  }
}
