"use client";

import { ReactNode, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// ── Icons ──────────────────────────────────────────────────────────────────

function IconToday() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  );
}

function IconAccounts() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
    </svg>
  );
}

function IconContacts() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}

function IconOpportunities() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}

function IconChevronLeft() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
    </svg>
  );
}

function IconProspects() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
    </svg>
  );
}
function IconManager() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zm9.75-4.5c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zm-4.875 5.25c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v5.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125v-5.25z" />
    </svg>
  );
}

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  orgName: string;
  orgRole: string | null;
  fullName: string;
  email: string;
  hasOrg: boolean;
  signOutAction: () => Promise<void>;
  children: ReactNode;
};

// ── Base bottom nav items (mobile only) ────────────────────────────────────

const BASE_BOTTOM_NAV = [
  { href: "/app/today", label: "Today", icon: <IconToday /> },
  { href: "/app/accounts", label: "Accounts", icon: <IconAccounts /> },
  { href: "/app/contacts", label: "Contacts", icon: <IconContacts /> },
  { href: "/app/opportunities", label: "Pipeline", icon: <IconOpportunities /> },
] as const;

// ── Helpers ────────────────────────────────────────────────────────────────

function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}

function Avatar({ name, email }: { name: string; email: string }) {
  const letter = (name || email || "?").charAt(0).toUpperCase();
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
      {letter}
    </span>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function AppShell({
  orgName,
  orgRole,
  fullName,
  email,
  hasOrg,
  signOutAction,
  children,
}: Props) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const canSeeAdmin = orgRole === "admin" || orgRole === "manager";

  // Primary nav items
  const sidebarItems = canSeeAdmin
    ? [
        { href: "/app/today", label: "Today" },
        { href: "/app/manager", label: "Team" },
        { href: "/app/accounts", label: "Accounts" },
        { href: "/app/contacts", label: "Contacts" },
        { href: "/app/properties", label: "Properties" },
        { href: "/app/opportunities", label: "Pipeline" },
        { href: "/app/manager/prospects", label: "Prospects" },
        { href: "/app/manager/analytics", label: "Reports" },
      ]
    : [
        { href: "/app/today", label: "Today" },
        { href: "/app/accounts", label: "Accounts" },
        { href: "/app/properties", label: "Properties" },
        { href: "/app/contacts", label: "Contacts" },
        { href: "/app/opportunities", label: "Pipeline" },
      ];

  // Settings items (manager only, collapsible)
  const settingsItems = canSeeAdmin
    ? [
        { href: "/app/manager/territories", label: "Territories" },
        { href: "/app/manager/icp", label: "ICP Profile" },
        { href: "/app/admin/team", label: "Team Members" },
        { href: "/app/admin/kpis", label: "KPI Targets" },
        { href: "/app/manager/agent", label: "Agents" },
      ]
    : [];

  if (!hasOrg) {
    sidebarItems.push({ href: "/app/setup", label: "Setup" });
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Desktop sidebar ── */}
      <aside
        className={[
          "fixed inset-y-0 left-0 z-30 hidden flex-col overflow-hidden border-r border-slate-800 bg-slate-900 transition-[width] duration-200 md:flex",
          sidebarOpen ? "w-56" : "w-0",
        ].join(" ")}
      >
        {/* Org header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-4">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-widest text-blue-400">Dilly</div>
            <div className="mt-0.5 truncate text-sm font-semibold text-white">{orgName}</div>
            <div className="text-xs capitalize text-slate-400">{orgRole ?? "member"}</div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-2 shrink-0 rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-white"
            aria-label="Collapse sidebar"
          >
            <IconChevronLeft />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <div className="space-y-0.5">
            {sidebarItems.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    "block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-blue-600 text-white"
                      : "text-slate-300 hover:bg-slate-800 hover:text-white",
                  ].join(" ")}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>

          {/* Settings section (manager only) */}
          {settingsItems.length > 0 && (
            <div className="mt-4 border-t border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => setSettingsOpen(!settingsOpen)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-300"
              >
                Settings
                <span className="text-[10px]">{settingsOpen ? "▼" : "▶"}</span>
              </button>
              {settingsOpen && (
                <div className="mt-1 space-y-0.5">
                  {settingsItems.map((item) => {
                    const active = isActive(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={[
                          "block rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                          active
                            ? "bg-blue-600 text-white"
                            : "text-slate-400 hover:bg-slate-800 hover:text-white",
                        ].join(" ")}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Profile */}
        <div className="border-t border-slate-800 p-3">
          <div className="relative">
            <button
              onClick={() => setProfileOpen(!profileOpen)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-slate-800"
            >
              <Avatar name={fullName} email={email} />
              <div className="min-w-0 text-left">
                <div className="truncate text-xs font-medium text-white">{fullName || email}</div>
                <div className="truncate text-xs text-slate-400">{email}</div>
              </div>
            </button>

            {profileOpen && (
              <div className="absolute bottom-full left-0 mb-1 w-52 rounded-xl border border-slate-700 bg-slate-800 p-2 shadow-xl">
                <div className="px-3 py-1.5 text-xs text-slate-400">{email}</div>
                <div className="my-1 border-t border-slate-700" />
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-700 hover:text-white"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Desktop sidebar open button (shown when collapsed) */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="fixed left-3 top-3 z-40 hidden items-center justify-center rounded-md border border-slate-700 bg-slate-900 p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white md:flex"
          aria-label="Open sidebar"
        >
          <IconMenu />
        </button>
      )}

      {/* ── Mobile header ── */}
      <header className="fixed inset-x-0 top-0 z-20 h-14 border-b border-slate-800 bg-slate-900 md:hidden">
        <div className="flex h-full items-center justify-between px-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-blue-400">Dilly</span>
            <span className="ml-2 text-sm font-semibold text-white">{orgName}</span>
          </div>

          <div className="relative">
            <button
              onClick={() => setProfileOpen(!profileOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white"
              aria-label="Profile menu"
            >
              {(fullName || email || "?").charAt(0).toUpperCase()}
            </button>

            {profileOpen && (
              <div className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-slate-700 bg-slate-800 p-2 shadow-xl">
                <div className="px-3 py-1.5 text-xs text-slate-400">{fullName || email}</div>
                <div className="px-3 py-1 text-xs capitalize text-slate-500">{orgRole ?? "member"}</div>
                <div className="my-1 border-t border-slate-700" />
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-700 hover:text-white"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Main content ── */}
      <div
        className={[
          "flex min-h-screen flex-col transition-[padding-left] duration-200",
          sidebarOpen ? "md:pl-56" : "md:pl-0",
        ].join(" ")}
      >
        <main className="flex-1 pb-16 pt-14 md:pb-0 md:pt-0">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>

      {/* ── Mobile bottom nav ── */}
      <nav className="fixed inset-x-0 bottom-0 z-20 h-16 border-t border-slate-200 bg-white md:hidden">
        <div className="flex h-full">
          {[...BASE_BOTTOM_NAV, ...(canSeeAdmin ? [
            { href: "/app/manager", label: "Team", icon: <IconManager /> },
            { href: "/app/manager/prospects", label: "Prospects", icon: <IconProspects /> },
          ] : [])].map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors",
                  active ? "text-blue-600" : "text-slate-400 hover:text-slate-700",
                ].join(" ")}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
