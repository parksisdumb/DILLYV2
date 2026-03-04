type DashboardData = {
  points_today: number;
  first_touch_outreach_today: number;
  target_first_touch_outreach: number;
  remaining_first_touch_outreach: number;
  follow_up_outreach_today: number;
  target_follow_up_outreach: number;
  remaining_follow_up_outreach: number;
  next_actions_due_today: number;
  next_actions_overdue: number;
  streak: number;
};

type Props = { dashboard: DashboardData };

function pct(count: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(Math.round((count / target) * 100), 100);
}

function barColor(remaining: number, percentage: number): string {
  if (percentage >= 100) return "bg-emerald-500";
  if (percentage > 0) return "bg-blue-500";
  return "bg-slate-200";
}

type ProgressCardProps = {
  label: string;
  sublabel: string;
  count: number;
  target: number;
  remaining: number;
};

function ProgressCard({ label, sublabel, count, target, remaining }: ProgressCardProps) {
  const percentage = pct(count, target);
  const done = remaining <= 0;
  const fill = barColor(remaining, percentage);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
          <div className="text-xs text-slate-400">{sublabel}</div>
        </div>
        {done ? (
          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
            Done
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
            {percentage}%
          </span>
        )}
      </div>

      <div className="mt-3">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold tabular-nums text-slate-900">{count}</span>
          <span className="text-sm font-medium text-slate-400">/ {target}</span>
        </div>
        <div className="mt-1 text-xs text-slate-500">
          {done ? "Target hit!" : `${remaining} remaining`}
        </div>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={["h-full rounded-full transition-all duration-500", fill].join(" ")}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export default function Scoreboard({ dashboard }: Props) {
  const {
    points_today,
    first_touch_outreach_today,
    target_first_touch_outreach,
    remaining_first_touch_outreach,
    follow_up_outreach_today,
    target_follow_up_outreach,
    remaining_follow_up_outreach,
    next_actions_due_today,
    next_actions_overdue,
    streak,
  } = dashboard;

  return (
    <div className="space-y-3">
      {/* Progress cards — first touch + follow-up */}
      <div className="grid grid-cols-2 gap-3">
        <ProgressCard
          label="First Touch"
          sublabel="Grow"
          count={first_touch_outreach_today}
          target={target_first_touch_outreach}
          remaining={remaining_first_touch_outreach}
        />
        <ProgressCard
          label="Follow-Up"
          sublabel="Advance"
          count={follow_up_outreach_today}
          target={target_follow_up_outreach}
          remaining={remaining_follow_up_outreach}
        />
      </div>

      {/* Metric tiles */}
      <div className="grid grid-cols-3 gap-3">
        {/* Points */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Points</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{points_today}</div>
          <div className="text-xs text-slate-400">today</div>
        </div>

        {/* Streak */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Streak</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-bold tabular-nums text-slate-900">{streak}</span>
            {streak > 0 && <span className="text-base">🔥</span>}
          </div>
          <div className="text-xs text-slate-400">days</div>
        </div>

        {/* Next actions */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
            {next_actions_due_today}
          </div>
          <div className="text-xs">
            {next_actions_overdue > 0 ? (
              <span className="font-medium text-rose-600">{next_actions_overdue} overdue</span>
            ) : (
              <span className="text-slate-400">due today</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
