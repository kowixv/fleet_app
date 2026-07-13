"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/maintenance", label: "Özet", exact: true },
  { href: "/maintenance/units", label: "Araçlar" },
  { href: "/maintenance/invoices", label: "Faturalar" },
  { href: "/maintenance/inspections", label: "İncelemeler" },
  { href: "/maintenance/costs", label: "Maliyetler" },
  { href: "/maintenance/settings", label: "Ayarlar" },
];

export default function MaintenanceNav({ title = "Bakım Merkezi" }: { title?: string }) {
  const pathname = usePathname();
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">{title}</h1>
      <nav className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-2 text-sm">
        {ITEMS.map((item) => {
          const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
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
