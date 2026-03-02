"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type SidebarNavItem = {
  href: string;
  label: string;
};

type SidebarNavProps = {
  items: SidebarNavItem[];
};

function isActivePath(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/app") return pathname.startsWith("/app");
  return pathname.startsWith(`${href}/`);
}

export default function SidebarNav({ items }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <nav className="space-y-1">
      {items.map((item) => {
        const active = isActivePath(pathname, item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={[
              "block rounded-lg px-3 py-2 text-sm transition",
              active
                ? "bg-indigo-600 text-white"
                : "text-slate-700 hover:bg-slate-50 hover:text-slate-900",
            ].join(" ")}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
