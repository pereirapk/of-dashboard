"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/lib/icons";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  disabled?: boolean;
}

const NAV: NavItem[] = [
  { href: "/", label: "Visão geral", icon: "layout-dashboard" },
  { href: "/transactions", label: "Transações", icon: "arrow-down-up" },
  { href: "/accounts", label: "Contas", icon: "wallet" },
  { href: "/settings", label: "Configurações", icon: "settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col gap-1 border-r border-foreground/10 bg-foreground/[0.02] p-4">
      <div className="px-2 py-3">
        <p className="text-base font-semibold">Cumbuca</p>
        <p className="text-xs opacity-60">Open Finance</p>
      </div>
      <nav className="flex flex-col gap-0.5 mt-2">
        {NAV.map((item) => {
          const active = pathname === item.href;
          if (item.disabled) {
            return (
              <span
                key={item.href}
                className="flex items-center justify-between gap-2 px-2 py-2 text-sm rounded-md opacity-40 cursor-not-allowed"
                title="em breve"
              >
                <span className="flex items-center gap-2">
                  <Icon name={item.icon} size={16} />
                  <span>{item.label}</span>
                </span>
                <span className="text-[10px] uppercase tracking-wide opacity-70">
                  em breve
                </span>
              </span>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 px-2 py-2 text-sm rounded-md transition-colors ${
                active
                  ? "bg-foreground/10 font-medium"
                  : "hover:bg-foreground/5"
              }`}
            >
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
