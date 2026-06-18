"use client";

// Dropdown to filter a list by file completeness, so reps can surface records
// that still need data. Pairs with matchesCompleteness() from @/lib/completeness.

export default function CompletenessFilter({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <select
      aria-label="Filter by completeness"
      className={
        className ??
        "h-10 rounded-xl border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
      }
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">All completeness</option>
      <option value="incomplete">Needs data</option>
      <option value="complete">Complete</option>
    </select>
  );
}
