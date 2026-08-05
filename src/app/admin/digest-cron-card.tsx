// Last-run status for the follow-up digest cron, shown on the platform admin
// dashboard. Server component (no interactivity) — dark theme to match /admin.

type Run = {
  status: string;
  startedAt: string;
  finishedAt: string | null;
  summary: Record<string, unknown> | null;
  error: string | null;
};

const STALE_MS = 26 * 60 * 60 * 1000; // > ~a day between runs = something is wrong

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
}

export function DigestCronCard({ enabled, run }: { enabled: boolean; run: Run | null }) {
  const ageMs = run ? Date.now() - new Date(run.startedAt).getTime() : Infinity;
  const stale = run ? ageMs > STALE_MS : false;
  const running = run?.status === "running";

  // Health: error > stale/never > running > ok.
  let tone: "ok" | "warn" | "bad" = "ok";
  let headline = "Healthy";
  if (!run) {
    tone = enabled ? "warn" : "ok";
    headline = enabled ? "No run recorded yet" : "Not armed";
  } else if (run.status === "error") {
    tone = "bad";
    headline = "Last run errored";
  } else if (running && stale) {
    tone = "bad";
    headline = "Run stuck (did not finish)";
  } else if (enabled && stale) {
    tone = "warn";
    headline = "Last run is stale";
  } else if (running) {
    tone = "warn";
    headline = "Running…";
  } else {
    tone = "ok";
    headline = "Healthy";
  }

  const toneStyles: Record<typeof tone, string> = {
    ok: "border-emerald-800 bg-emerald-950/40",
    warn: "border-amber-800 bg-amber-950/40",
    bad: "border-red-800 bg-red-950/40",
  };
  const dotStyles: Record<typeof tone, string> = {
    ok: "bg-emerald-400",
    warn: "bg-amber-400",
    bad: "bg-red-400",
  };

  const s = run?.summary ?? null;
  const num = (k: string): number | null => (s && typeof s[k] === "number" ? (s[k] as number) : null);

  return (
    <div className={`mt-6 rounded-2xl border p-4 ${toneStyles[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${dotStyles[tone]}`} />
          <span className="text-sm font-semibold text-white">Follow-up digest cron</span>
          <span className="text-sm text-slate-300">— {headline}</span>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            enabled ? "bg-blue-600/30 text-blue-200" : "bg-slate-700 text-slate-300"
          }`}
        >
          {enabled ? "Armed (7:00 AM CT daily)" : "Disabled (kill switch)"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-300 sm:grid-cols-3">
        <div>Last started: <span className="text-slate-100">{fmt(run?.startedAt ?? null)}</span></div>
        <div>Finished: <span className="text-slate-100">{fmt(run?.finishedAt ?? null)}</span></div>
        <div>Status: <span className="text-slate-100">{run?.status ?? "never run"}</span></div>
      </div>

      {s && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
          <span>Sent: <span className="font-semibold text-slate-100">{num("sent") ?? 0}</span></span>
          <span>Considered: {num("considered") ?? 0}</span>
          <span>Empty: {num("skippedEmpty") ?? 0}</span>
          <span>Opted out: {num("skippedOptOut") ?? 0}</span>
          <span>Already sent: {num("skippedAlreadySent") ?? 0}</span>
          <span className={num("errors") ? "text-red-300" : ""}>Errors: {num("errors") ?? 0}</span>
        </div>
      )}

      {run?.error && (
        <div className="mt-2 rounded-lg border border-red-800 bg-red-950/60 px-3 py-2 text-xs text-red-200">
          {run.error}
        </div>
      )}

      {!enabled && (
        <p className="mt-2 text-xs text-slate-400">
          Kill switch engaged — remove <code className="text-slate-200">FOLLOW_UP_DIGEST_ENABLED=false</code> from the
          environment to re-arm the daily send.
        </p>
      )}
    </div>
  );
}
