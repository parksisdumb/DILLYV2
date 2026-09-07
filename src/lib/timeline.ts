// Merge several touchpoint sources (direct + related-via-graph) into one deduped,
// recency-sorted timeline. Each source carries a label function so indirect rows
// can be tagged "via <contact/property>". Earlier sources win on both dedupe and
// label priority — pass the direct source first so a touchpoint that is both
// direct and indirect reads as direct.
//
// Correctness of the per-source LIMIT: if each source returns its own N most
// recent, the union's N most recent is guaranteed to be within that union (a row
// in the global top-N ranks no lower within its own source), so callers can cap
// each source query at `limit` and still get the true global top-N after merge.

export type TimelineSource<T> = {
  rows: T[];
  labelFor: (row: T) => string | null;
};

export function mergeTimeline<T extends { id: string; happened_at: string }>(
  sources: TimelineSource<T>[],
  limit = 50,
): (T & { sourceLabel: string | null })[] {
  const seen = new Map<string, T & { sourceLabel: string | null }>();
  for (const src of sources) {
    for (const row of src.rows) {
      if (seen.has(row.id)) continue; // earlier source wins (priority + dedupe)
      seen.set(row.id, { ...row, sourceLabel: src.labelFor(row) });
    }
  }
  return [...seen.values()]
    .sort((a, b) => (a.happened_at < b.happened_at ? 1 : a.happened_at > b.happened_at ? -1 : 0))
    .slice(0, limit);
}
