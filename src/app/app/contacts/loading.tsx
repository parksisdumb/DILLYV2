function Bone({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-slate-200 ${className ?? ""}`} />;
}

export default function Loading() {
  return (
    <div className="space-y-4">
      <Bone className="h-8 w-48" />
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <Bone className="h-4 w-full" />
        <Bone className="h-4 w-3/4" />
        <Bone className="h-4 w-1/2" />
        <Bone className="h-4 w-2/3" />
        <Bone className="h-4 w-5/6" />
        <Bone className="h-4 w-3/5" />
      </div>
    </div>
  );
}
