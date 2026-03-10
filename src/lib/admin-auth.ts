import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const ADMIN_SESSION_TOKEN = "dilly-admin-authenticated";

/**
 * Call at the top of every protected /admin server component.
 * Redirects to /admin/login if the session cookie is missing or invalid.
 */
export async function requireAdminAuth() {
  const cookieStore = await cookies();
  const session = cookieStore.get("admin_session");
  if (!session || session.value !== ADMIN_SESSION_TOKEN) {
    redirect("/admin/login");
  }
}
