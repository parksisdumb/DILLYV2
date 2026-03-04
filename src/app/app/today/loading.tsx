function Bone({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-slate-200 ${className ?? ""}`} />;
}

export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Scoreboard */}
      <div className="grid grid-cols-3 gap-3">
        <Bone className="h-20" />
        <Bone className="h-20" />
        <Bone className="h-20" />
      </div>

      {/* Section title */}
      <Bone className="h-6 w-32" />

      {/* Action cards */}
      <div className="space-y-3">
        <Bone className="h-20" />
        <Bone className="h-20" />
        <Bone className="h-20" />
      </div>

      {/* Section title */}
      <Bone className="h-6 w-28" />

      {/* More cards */}
      <div className="space-y-3">
        <Bone className="h-16" />
        <Bone className="h-16" />
      </div>
    </div>
  );
}
