"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export type DemoResult = { ok: boolean; error?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Public demo-request submission from the landing page. Runs server-side and
// writes via the service-role admin client — the browser never touches the table.
// Degrades gracefully (friendly error) if the demo_requests migration isn't applied.
export async function submitDemoRequest(formData: FormData): Promise<DemoResult> {
  const name = String(formData.get("name") ?? "").trim();
  const company = String(formData.get("company") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  // Honeypot: real users never see/fill this. Bots do — silently accept & drop.
  const trap = String(formData.get("website") ?? "").trim();
  if (trap) return { ok: true };

  if (!name) return { ok: false, error: "Please add your name." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Please enter a valid email." };

  try {
    const ua = (await headers()).get("user-agent")?.slice(0, 400) ?? null;
    const supabase = createAdminClient();
    const { error } = await supabase.from("demo_requests").insert({
      name: name.slice(0, 200),
      company: company ? company.slice(0, 200) : null,
      email: email.slice(0, 320),
      source: "landing",
      user_agent: ua,
    });
    if (error) return { ok: false, error: "Something went wrong — please try again." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Something went wrong — please try again." };
  }
}
