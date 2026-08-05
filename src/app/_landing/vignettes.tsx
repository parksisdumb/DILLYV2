import { Counter } from "./counter";

// Live-feeling product vignettes for the landing page. All motion is CSS
// (keyframes defined once in landing.tsx); only ticking numbers use the client
// Counter. Everything here is a mock — no real data, no network.

function Dot({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${className}`} />;
}

// Hero: the Today queue checking itself off + a leaderboard with a ticking score.
export function TodayVignette() {
  const rows = [
    { name: "Greystar — Riverside", sub: "Follow-up · due today", delay: "0s" },
    { name: "Hines — 300 Colorado", sub: "First touch · P1", delay: "0.5s" },
    { name: "CBRE — Domain Tower", sub: "Follow-up · due today", delay: "1s" },
    { name: "Lincoln — Mueller", sub: "First touch · P2", delay: "1.5s" },
  ];
  return (
    <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-2xl backdrop-blur">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold text-white">Today</div>
        <div className="flex items-center gap-1.5 text-xs text-emerald-400">
          <Dot className="bg-emerald-400 dl-live" />
          live
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.name}
            className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5"
          >
            <span
              className="dl-check flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white"
              style={{ animationDelay: r.delay }}
            >
              <svg viewBox="0 0 20 20" fill="none" className="h-3 w-3">
                <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-white">{r.name}</div>
              <div className="truncate text-xs text-slate-400">{r.sub}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.03] p-3">
        <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
          <span>Team scoreboard</span>
          <span>this week</span>
        </div>
        <div className="space-y-1.5">
          {[
            { rank: "1", name: "You", pts: 482, hot: true },
            { rank: "2", name: "M. Torres", pts: 451, hot: false },
            { rank: "3", name: "J. Nguyen", pts: 419, hot: false },
          ].map((r) => (
            <div key={r.name} className="flex items-center gap-2 text-sm">
              <span className="w-4 text-xs text-slate-500">{r.rank}</span>
              <span className={`flex-1 ${r.hot ? "font-semibold text-white" : "text-slate-300"}`}>{r.name}</span>
              {r.hot ? (
                <Counter to={r.pts} immediate className="font-semibold tabular-nums text-blue-400" />
              ) : (
                <span className="tabular-nums text-slate-400">{r.pts}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Loop 1 — Capture in 3 taps. A quick-log sheet mid-entry.
export function QuickLogVignette() {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
      <div className="mb-2 text-xs font-medium text-slate-400">Quick Log</div>
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white">
        Greystar — Riverside
        <span className="dl-blink ml-0.5 inline-block h-4 w-px bg-blue-400" />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {["Call", "Email", "Text", "Door knock"].map((t, i) => (
          <span
            key={t}
            className={`rounded-full px-2.5 py-1 text-xs ${
              i === 0 ? "bg-blue-600 font-medium text-white" : "border border-white/10 text-slate-400"
            }`}
          >
            {t}
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {["Connected", "Voicemail", "Gatekeeper"].map((t, i) => (
          <span
            key={t}
            className={`rounded-full px-2.5 py-1 text-xs ${
              i === 0 ? "bg-emerald-600/90 font-medium text-white" : "border border-white/10 text-slate-400"
            }`}
          >
            {t}
          </span>
        ))}
      </div>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="dl-pulse mt-3 w-full rounded-lg bg-blue-600 py-2 text-center text-sm font-semibold text-white"
      >
        Log touch · +10
      </button>
    </div>
  );
}

// Loop 2 — Never drop a follow-up. Outcome auto-schedules the next touch.
export function FollowUpVignette() {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-medium text-slate-400">Advance</span>
        <span className="text-slate-500">next 7 days</span>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
          <Dot className="bg-amber-400" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-white">Hines — call back Thu</div>
            <div className="text-xs text-slate-500">auto-scheduled from “Voicemail”</div>
          </div>
        </div>
        <div className="dl-slide flex items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2">
          <Dot className="bg-blue-400" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-white">CBRE — send bid Fri</div>
            <div className="text-xs text-blue-300/80">just added</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Loop 3 — Think in portfolios. One owner, many buildings.
export function PortfolioVignette() {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-white">Hines</span>
        <span className="rounded-full bg-blue-600/20 px-2 py-0.5 text-xs font-medium text-blue-300">P1</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { n: 6, l: "buildings" },
          { n: 30, l: "contacts" },
          { n: 4, l: "open bids" },
        ].map((s) => (
          <div key={s.l} className="rounded-lg border border-white/5 bg-white/[0.03] py-2">
            <div className="text-lg font-bold tabular-nums text-white">
              <Counter to={s.n} />
            </div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">{s.l}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-1.5 text-xs text-slate-400">
        <Dot className="bg-emerald-400" /> 2 buildings inspected this month
      </div>
    </div>
  );
}

// Loop 4 — Run the team. Manager coaching surface.
export function TeamVignette() {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
      <div className="mb-2 text-xs font-medium text-slate-400">Team · today</div>
      <div className="space-y-1.5">
        {[
          { name: "M. Torres", pct: 92 },
          { name: "You", pct: 78 },
          { name: "J. Nguyen", pct: 41 },
        ].map((r) => (
          <div key={r.name} className="flex items-center gap-2">
            <span className="w-16 shrink-0 truncate text-xs text-slate-300">{r.name}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full ${r.pct >= 60 ? "bg-blue-500" : "bg-amber-500"}`}
                style={{ width: `${r.pct}%` }}
              />
            </div>
            <span className="w-8 text-right text-xs tabular-nums text-slate-400">{r.pct}%</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
        <Dot className="bg-amber-400" />
        Greystar (P1) going quiet — 11 days
      </div>
    </div>
  );
}
