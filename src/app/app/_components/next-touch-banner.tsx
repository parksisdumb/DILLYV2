// The soonest open follow-up for a contact/account, shown near the top of the
// detail page so the schedule is visible wherever the rep is. Renders nothing
// when there's no open next_action.

export function NextTouchBanner({ dueAt, notes }: { dueAt: string | null | undefined; notes?: string | null }) {
  if (!dueAt) return null;
  const date = new Date(dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
      <svg className="h-4 w-4 shrink-0 text-blue-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v9a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm9 5H5v7h10V7z"
          clipRule="evenodd"
        />
      </svg>
      <span className="font-semibold text-blue-900">Next touch: {date}</span>
      {notes ? <span className="min-w-0 truncate text-blue-700">— {notes}</span> : null}
    </div>
  );
}
