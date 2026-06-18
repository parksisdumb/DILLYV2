"use client";

// Dropdown to filter a list by the rep who uploaded/created each record
// (matches on the record's created_by). Shared across the accounts, properties,
// contacts, and opportunities list pages.

export type RepOption = { userId: string; name: string };

export default function RepFilter({
  reps,
  value,
  onChange,
  className,
}: {
  reps: RepOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <select
      aria-label="Filter by uploader"
      className={
        className ??
        "h-10 rounded-xl border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
      }
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">All uploaders</option>
      {reps.map((r) => (
        <option key={r.userId} value={r.userId}>
          {r.name}
        </option>
      ))}
    </select>
  );
}
