import { requireServerOrgContext } from "@/lib/supabase/server-org";

type Conn = {
  email_address: string | null;
  status: string;
  last_synced_at: string | null;
  last_error: string | null;
};

const ERROR_LABELS: Record<string, string> = {
  no_refresh_token: "Google didn't return a refresh token. Please try connecting again.",
  bad_state: "The connection request expired or didn't match your session. Try again.",
  missing_code: "Google didn't return an authorization code. Try again.",
  store_failed: "Couldn't save the connection. Try again.",
  exception: "Something went wrong connecting Gmail. Try again.",
};

function formatWhen(iso: string | null): string {
  if (!iso) return "not yet";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, userId } = await requireServerOrgContext();
  const sp = await searchParams;

  const { data } = await supabase
    .from("email_connections")
    .select("email_address,status,last_synced_at,last_error")
    .eq("user_id", userId)
    .eq("provider", "gmail")
    .maybeSingle();

  const conn = data as Conn | null;
  const connected = conn?.status === "active";
  const errored = conn?.status === "error";

  const gmailError = typeof sp.gmail_error === "string" ? sp.gmail_error : null;
  const justConnected = sp.gmail_connected === "1";
  const justDisconnected = sp.gmail_disconnected === "1";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Settings</h1>

      {/* Banners */}
      {justConnected && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Gmail connected. Your sent &amp; received emails to known contacts will start logging shortly.
        </div>
      )}
      {justDisconnected && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Gmail disconnected.
        </div>
      )}
      {gmailError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {ERROR_LABELS[gmailError] ?? "Couldn't connect Gmail. Try again."}
        </div>
      )}

      {/* Email integration card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-800">Email — Gmail</h2>
            <p className="mt-1 text-sm text-slate-500">
              Connect your Gmail so emails to and from your contacts log automatically as
              touchpoints, and you get follow-up nudges on Today. We read message metadata only
              (sender, recipient, subject, date) — never message bodies.
            </p>

            {connected && (
              <div className="mt-3 space-y-1 text-sm">
                <p className="font-medium text-slate-800">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-green-500 align-middle" />
                  Connected as {conn?.email_address ?? "your mailbox"}
                </p>
                <p className="text-slate-500">Last synced: {formatWhen(conn?.last_synced_at ?? null)}</p>
              </div>
            )}
            {errored && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Sync hit an error{conn?.last_error ? `: ${conn.last_error}` : ""}. Reconnect to fix it.
              </div>
            )}
          </div>

          <div className="shrink-0">
            {connected || errored ? (
              <form action="/api/google/gmail/disconnect" method="post">
                <button
                  type="submit"
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Disconnect
                </button>
              </form>
            ) : (
              <a
                href="/api/google/gmail/connect"
                className="inline-block rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Connect Gmail
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Outlook — placeholder (phase 1 is Gmail-only) */}
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5">
        <h2 className="text-sm font-semibold text-slate-500">Email — Outlook</h2>
        <p className="mt-1 text-sm text-slate-400">Coming soon.</p>
      </div>
    </div>
  );
}
