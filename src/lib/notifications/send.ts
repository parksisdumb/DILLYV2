import "server-only";

// Thin Resend wrapper — REST API via fetch, no SDK dependency.
//
// Env:
//   RESEND_API_KEY   — required to actually send (absent → sends are no-ops that
//                      report a clear error instead of throwing).
//   RESEND_FROM      — "Name <addr@domain>". Defaults to Resend's onboarding
//                      sender, which sends ONLY to your own Resend account email
//                      without domain verification — perfect for the admin test
//                      send. Set to a verified-domain sender before the org-wide
//                      rollout.
//   NEXT_PUBLIC_APP_URL — base URL for links inside emails.
//   FOLLOW_UP_DIGEST_ENABLED — kill switch. The cron is ARMED by default; set this
//                      to "false" (or "off"/"0") to disable the morning blast
//                      without a redeploy.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function digestCronEnabled(): boolean {
  const v = (process.env.FOLLOW_UP_DIGEST_ENABLED ?? "").toLowerCase();
  return v !== "false" && v !== "off" && v !== "0";
}

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function fromAddress(): string {
  return process.env.RESEND_FROM || "Dilly <onboarding@resend.dev>";
}

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string };

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set" };

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text,
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` };
    }

    const json = (await res.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: json?.id ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
