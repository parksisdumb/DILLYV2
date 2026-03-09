import { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {children}
    </div>
  );
}
