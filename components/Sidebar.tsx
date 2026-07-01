"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV: { href: string; label: string; group?: string }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/imported", label: "Telegram Yükleri", group: "Operasyon" },
  { href: "/loads", label: "Loads" },
  { href: "/tracking", label: "🗺 Tracking" },
  { href: "/expenses", label: "Expenses" },
  { href: "/settlements", label: "Settlements" },
  { href: "/vehicles", label: "Vehicles / Units", group: "Kayıtlar" },
  { href: "/people", label: "Drivers / Owners" },
  { href: "/companies", label: "Companies" },
  { href: "/carriers", label: "External Carriers" },
  { href: "/maintenance", label: "Maintenance", group: "Bakım" },
  { href: "/settings", label: "Settings", group: "Sistem" },
];

export default function Sidebar() {
  const path = usePathname();
  let lastGroup: string | undefined;

  return (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="px-2 py-3 text-lg font-bold text-brand">🚚 Fleet</div>
      {NAV.map((item) => {
        const active =
          item.href === "/" ? path === "/" : path.startsWith(item.href);
        const showGroup = item.group && item.group !== lastGroup;
        lastGroup = item.group ?? lastGroup;
        return (
          <div key={item.href}>
            {showGroup && (
              <div className="mt-3 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {item.group}
              </div>
            )}
            <Link
              href={item.href}
              className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
                active
                  ? "bg-brand text-white"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {item.label}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
