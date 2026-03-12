import { ReactNode } from "react";
import Link from "next/link";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/admin" className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-blue-400">Dilly</span>
            <span className="text-sm font-medium text-slate-400">Admin</span>
          </Link>
          <form action="/admin/logout" method="POST" className="inline">
            <button
              type="submit"
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Logout
            </button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
