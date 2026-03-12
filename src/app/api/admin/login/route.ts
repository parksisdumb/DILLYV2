import { NextRequest } from "next/server";
import crypto from "crypto";

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  const adminSecret = process.env.ADMIN_SECRET_KEY;

  if (!adminSecret || String(password).trim() !== adminSecret) {
    return Response.json({ error: "Invalid secret key" }, { status: 401 });
  }

  const token = crypto.createHash("sha256").update(adminSecret).digest("hex");
  return Response.json({ token });
}
