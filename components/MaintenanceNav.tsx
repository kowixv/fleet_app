"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const ITEMS = [
  { href: "/maintenance", label: "Overview", exact: true },
  { href: "/maintenance?add=1", label: "Bakım Ekle", queryActive: "add" },
  { href: "/maintenance/units", label: "Units" },
  { href: "/maintenance/history", label: "Geçmiş" },
  { href: "/maintenance/costs", label: "Costs" },
  { href: "/maintenance/settings", label: "Settings" },
];

export default function MaintenanceNav({ title = "Bakım Merkezi" }: { title?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">{title}</h1>
      <nav className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-2 text-sm">
        {ITEMS.map((item) => {
          const active = item.queryActive
            ? pathname === "/maintenance" && searchParams.get(item.queryActive) === "1"
            : item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 ${
                active ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
