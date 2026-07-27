"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "Runs" },
  { href: "/dashboard/keys", label: "API keys" },
];

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((link) => {
        const active =
          link.href === "/dashboard"
            ? pathname === "/dashboard" || pathname.startsWith("/dashboard/runs")
            : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
