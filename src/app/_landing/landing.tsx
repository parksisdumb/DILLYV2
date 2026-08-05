import Link from "next/link";
import { DemoForm } from "./demo-form";
import { Counter } from "./counter";
import {
  TodayVignette,
  QuickLogVignette,
  FollowUpVignette,
  PortfolioVignette,
  TeamVignette,
} from "./vignettes";

const KEYFRAMES = `
@keyframes dl-check { from { opacity: 0; transform: scale(0.4); } 60% { transform: scale(1.15); } to { opacity: 1; transform: scale(1); } }
@keyframes dl-live { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
@keyframes dl-blink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
@keyframes dl-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(37,99,235,0.55); } 50% { box-shadow: 0 0 0 7px rgba(37,99,235,0); } }
@keyframes dl-slide { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
.dl-check { animation: dl-check .5s ease both; }
.dl-live { animation: dl-live 1.8s ease-in-out infinite; }
.dl-blink { animation: dl-blink 1.1s step-end infinite; }
.dl-pulse { animation: dl-pulse 2.2s ease-in-out infinite; }
.dl-slide { animation: dl-slide .6s ease both; }
@media (prefers-reduced-motion: reduce) {
  .dl-check, .dl-live, .dl-blink, .dl-pulse, .dl-slide { animation: none !important; }
}
`;

const LOOP = [
  {
    step: "01",
    title: "Capture in 3 taps",
    body: "Log a call, a door knock, a site visit before you start the truck. Pick a contact, a type, an outcome — done. No forms, no laptop.",
    vignette: <QuickLogVignette />,
  },
  {
    step: "02",
    title: "Never drop a follow-up",
    body: "Every outcome schedules the next touch automatically. Voicemail today becomes a call back Thursday. The queue does the remembering.",
    vignette: <FollowUpVignette />,
  },
  {
    step: "03",
    title: "Think in portfolios",
    body: "One owner, every building, every contact — in one place. Work the relationship across the whole portfolio, not one address at a time.",
    vignette: <PortfolioVignette />,
  },
  {
    step: "04",
    title: "Run the team",
    body: "Managers see who’s on pace, who’s coasting, and which P1 accounts are going quiet — with the coaching moment surfaced before it’s a cold account.",
    vignette: <TeamVignette />,
  },
];

const NUMBERS = [
  { stat: "3 taps", label: "to log a touch from the field — no laptop required." },
  { stat: "14 days", label: "the longest a P1 account can go quiet unnoticed." },
  { stat: "674 rows", label: "imported, deduped and territory-mapped in one week." },
  { stat: "2 states", label: "already running commercial BD teams on Dilly." },
];

const VERTICALS = [
  { name: "Commercial Roofing", note: "Where we start", primary: true },
  { name: "HVAC", note: "Mechanical", primary: false },
  { name: "Plumbing", note: "Trade services", primary: false },
  { name: "Fire Protection", note: "Life safety", primary: false },
  { name: "Electrical", note: "Trade services", primary: false },
  { name: "Specialty Subs", note: "Envelope, restoration & more", primary: false },
];

const DILLY_WAY = [
  {
    who: "For the rep",
    body: "Wake up to a queue, not a blank CRM. Dilly tells you who to call, remembers every follow-up, and keeps score so the effort shows.",
  },
  {
    who: "For the manager",
    body: "See who’s on pace, who’s coasting, and which accounts are going quiet — in time to coach, not autopsy.",
  },
  {
    who: "For the owner",
    body: "A durable book of relationships that lives in the company, not in a rep’s phone. The pipeline stays even when people move.",
  },
];

function DillyMark() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-sm font-black text-white">
        D
      </span>
      <span className="text-lg font-bold tracking-tight text-white">Dilly</span>
    </Link>
  );
}

export function Landing() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased">
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />

      {/* NAV */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-slate-950/80 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <DillyMark />
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition hover:text-white"
            >
              Log in
            </Link>
            <a
              href="#demo"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              Get a demo
            </a>
          </div>
        </nav>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(37,99,235,0.18),transparent_70%)]"
        />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-5 py-16 sm:py-24 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">
              The Business Development OS for Commercial Construction
            </p>
            <h1 className="mt-4 text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Relationships win commercial work.{" "}
              <span className="text-blue-400">Dilly makes sure you never drop one.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-300">
              Daily first-touch outreach, disciplined follow-up, and a portfolio-aware pipeline — built for roofing and
              trade BD reps working out of a truck, not a desk.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#demo"
                className="rounded-xl bg-blue-600 px-6 py-3.5 text-base font-semibold text-white transition hover:bg-blue-500"
              >
                Get a demo
              </a>
              <a
                href="#loop"
                className="rounded-xl border border-white/15 px-6 py-3.5 text-base font-semibold text-slate-200 transition hover:border-white/30 hover:text-white"
              >
                See how it works
              </a>
            </div>
          </div>

          <div className="flex justify-center lg:justify-end">
            <TodayVignette />
          </div>
        </div>
      </section>

      {/* PROBLEM */}
      <section className="border-y border-white/5 bg-slate-900/40">
        <div className="mx-auto max-w-4xl px-5 py-16 sm:py-20">
          <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">The problem</p>
          <h2 className="mt-4 text-3xl font-bold leading-tight text-white sm:text-4xl">
            We audited one team’s quarter.{" "}
            <span className="text-blue-400">369 outbound calls. Zero logged follow-ups.</span>
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-slate-300">
            The relationships were there. The reps were working. But there was no system to carry a conversation to the
            next touch — so calls turned into voicemails, voicemails turned into silence, and warm accounts quietly went
            cold. Not for lack of effort. For lack of a follow-up engine.
          </p>
          <p className="mt-4 text-lg font-medium leading-relaxed text-white">
            A generic CRM stores what happened. Dilly makes sure the next thing happens.
          </p>
        </div>
      </section>

      {/* THE LOOP */}
      <section id="loop" className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">The loop</p>
          <h2 className="mt-4 text-3xl font-bold leading-tight text-white sm:text-4xl">
            One disciplined loop, run every single day.
          </h2>
          <p className="mt-4 text-lg text-slate-300">
            Capture, follow up, think in portfolios, run the team. Dilly is built around the four things that actually
            move commercial work forward.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {LOOP.map((p) => (
            <div
              key={p.step}
              className="flex flex-col justify-between gap-5 rounded-2xl border border-white/10 bg-slate-900/50 p-6 transition hover:border-white/20"
            >
              <div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold text-blue-400">{p.step}</span>
                  <h3 className="text-xl font-semibold text-white">{p.title}</h3>
                </div>
                <p className="mt-3 leading-relaxed text-slate-300">{p.body}</p>
              </div>
              <div>{p.vignette}</div>
            </div>
          ))}
        </div>
      </section>

      {/* SWITCHING */}
      <section className="border-y border-white/5 bg-slate-900/40">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:py-20 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">Switching</p>
            <h2 className="mt-4 text-3xl font-bold leading-tight text-white sm:text-4xl">
              Bring your spreadsheet. <span className="text-blue-400">Be live by Friday.</span>
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-slate-300">
              You’ve already got the book — it’s just trapped in a spreadsheet. Send it over. We dedupe it, map it to
              territories, and hand you a working pipeline. No six-week implementation, no consultant.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-6">
            <div className="text-sm text-slate-400">One roofer’s first import</div>
            <div className="mt-2 flex items-baseline gap-2">
              <Counter to={674} className="text-4xl font-extrabold tabular-nums text-white" />
              <span className="text-lg text-slate-400">rows in</span>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {[
                { n: 480, l: "accounts" },
                { n: 463, l: "contacts" },
                { n: 459, l: "properties" },
              ].map((s) => (
                <div key={s.l} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
                  <Counter to={s.n} className="text-2xl font-bold tabular-nums text-blue-400" />
                  <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">{s.l}</div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm text-slate-400">Deduped and mapped, ready to work — the same week.</p>
          </div>
        </div>
      </section>

      {/* NUMBERS STRIP */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {NUMBERS.map((n) => (
            <div key={n.stat} className="rounded-2xl border border-white/10 bg-slate-900/40 p-6">
              <div className="text-3xl font-extrabold tracking-tight text-white">{n.stat}</div>
              <div className="mt-2 text-sm leading-relaxed text-slate-400">{n.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* WHO IT'S FOR */}
      <section className="border-y border-white/5 bg-slate-900/40">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">Who it’s for</p>
            <h2 className="mt-4 text-3xl font-bold leading-tight text-white sm:text-4xl">
              Built for commercial roofing. Ready for the trades next door.
            </h2>
            <p className="mt-4 text-lg text-slate-300">
              The same BD discipline — daily outreach, relentless follow-up, portfolio thinking — works across every
              commercial trade that wins on relationships.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {VERTICALS.map((v) => (
              <div
                key={v.name}
                className={`rounded-2xl border p-5 ${
                  v.primary ? "border-blue-500/50 bg-blue-600/10" : "border-white/10 bg-slate-950/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold text-white">{v.name}</span>
                  {v.primary ? (
                    <span className="rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                      Start here
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-sm text-slate-400">{v.note}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* THE DILLY WAY */}
      <section className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">The Dilly way</p>
          <h2 className="mt-4 text-3xl font-bold leading-tight text-white sm:text-4xl">
            One system. Three jobs it does at once.
          </h2>
        </div>
        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {DILLY_WAY.map((c) => (
            <div key={c.who} className="rounded-2xl border border-white/10 bg-slate-900/50 p-6">
              <div className="text-sm font-semibold uppercase tracking-wide text-blue-400">{c.who}</div>
              <p className="mt-3 leading-relaxed text-slate-300">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* DEMO CTA */}
      <section id="demo" className="border-t border-white/5 bg-slate-900/40">
        <div className="mx-auto max-w-3xl px-5 py-16 sm:py-24">
          <div className="text-center">
            <h2 className="text-3xl font-bold leading-tight text-white sm:text-4xl">
              See Dilly on your book of business.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-slate-300">
              Tell us who you are and we’ll set up a walkthrough on your real accounts — not a canned demo.
            </p>
          </div>
          <div className="mx-auto mt-10 max-w-xl rounded-3xl border border-white/10 bg-slate-950/60 p-6 sm:p-8">
            <DemoForm />
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2">
            <DillyMark />
            <p className="text-sm text-slate-500">Powering commercial BD teams in 2 states.</p>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <a href="#loop" className="text-slate-400 transition hover:text-white">
              How it works
            </a>
            <a href="#demo" className="text-slate-400 transition hover:text-white">
              Get a demo
            </a>
            <Link href="/login" className="font-medium text-white transition hover:text-blue-400">
              Log in
            </Link>
          </div>
        </div>
        <div className="border-t border-white/5">
          <div className="mx-auto max-w-6xl px-5 py-5 text-xs text-slate-600">
            © {2026} Dilly. The Business Development OS for Commercial Construction.
          </div>
        </div>
      </footer>
    </div>
  );
}
