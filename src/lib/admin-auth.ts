import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function requireAdmin() {
  const cookieStore = await cookies();
  const session = cookieStore.get("admin_session")?.value;
  const adminSecret = process.env.ADMIN_SECRET_KEY;

  if (!adminSecret || session !== adminSecret) {
    redirect("/admin/login");
  }
}
