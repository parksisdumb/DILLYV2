"use client";

export type LeaderboardEntry = {
  userId: string;
  name: string;
  points: number;
};

const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * Compact "Team Leaderboard — This Week" card for the Today screen.
 * Shown to all roles. Ranks every org member by weekly points, medals for the
 * top 3, and highlights the current user's row.
 */
export default function TeamLeaderboard({
  entries,
  currentUserId,
}: {
  entries: LeaderboardEntry[];
  currentUserId: string;
}) {
  if (entries.length === 0) return null;

  const ranked = [...entries].sort(
    (a, b) => b.points - a.points || a.name.localeCompare(b.name),
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Team Leaderboard</h2>
        <span className="text-xs font-medium text-slate-500">This Week</span>
      </div>

      <div className="space-y-1">
        {ranked.map((e, idx) => {
          const isMe = e.userId === currentUserId;
          return (
            <div
              key={e.userId}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                isMe ? "bg-blue-50 ring-1 ring-blue-200" : ""
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="w-6 shrink-0 text-center text-base tabular-nums">
                  {idx < 3 ? (
                    MEDALS[idx]
                  ) : (
                    <span className="text-xs font-medium text-slate-400">{idx + 1}</span>
                  )}
                </span>
                <span
                  className={`truncate ${
                    isMe ? "font-semibold text-blue-900" : "text-slate-700"
                  }`}
                >
                  {e.name}
                  {isMe ? " (You)" : ""}
                </span>
              </div>
              <span
                className={`shrink-0 tabular-nums ${
                  isMe ? "font-bold text-blue-700" : "font-medium text-slate-600"
                }`}
              >
                {e.points.toLocaleString()} pts
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
