"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Map, Navigation, CreditCard, Phone, UserCog, FileText, X, Activity, Contact, Trash2, PieChart, BrainCircuit, BotMessageSquare, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebar } from "./SidebarContext";

const sidebarNavItems = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  { title: "Drivers", href: "/drivers", icon: Users },
  { title: "Live Map", href: "/live-map", icon: Map },
  { title: "Trips", href: "/trips", icon: Navigation },
  { title: "Expenses", href: "/expenses", icon: CreditCard },
  { title: "Call Logs", href: "/call-logs", icon: Phone },
  { title: "Analytics", href: "/analytics", icon: PieChart },
  { title: "Contact Intelligence", href: "/contact-intelligence", icon: BrainCircuit },
  { title: "Telegram Setup", href: "/telegram-setup", icon: BotMessageSquare },
  { title: "Bot Logs", href: "/bot-logs", icon: ScrollText },
  { title: "App Active Status", href: "/toggle-logs", icon: Activity },
  { title: "Contact Bank", href: "/contacts", icon: Contact },
  { title: "User Management", href: "/users", icon: UserCog },
  { title: "Reports", href: "/reports", icon: FileText },
  { title: "Test Data", href: "/test-data", icon: Trash2 },
];

export function Sidebar() {
  const pathname = usePathname();
  const { isOpen, close } = useSidebar();

  return (
    <>
      {/* ── Mobile backdrop overlay ── */}
      <div
        className={cn(
          "fixed inset-0 z-30 bg-black/60 backdrop-blur-sm transition-opacity duration-300 sm:hidden",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={close}
        aria-hidden="true"
      />

      {/* ── Sidebar panel ── */}
      <nav
        className={cn(
          // Base styles — always present
          "flex flex-col h-full bg-slate-900 border-r border-slate-800 text-slate-300 z-40",
          // Desktop: static, always visible, fixed width
          "sm:relative sm:translate-x-0 sm:w-64 sm:flex",
          // Mobile: fixed drawer, slides in/out
          "fixed top-0 left-0 bottom-0 w-72 transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full sm:translate-x-0"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-16 px-5 border-b border-slate-800 font-bold text-xl tracking-tight text-white flex-shrink-0">
          <span>FleetSaaS</span>
          {/* Close button — only shown on mobile */}
          <button
            onClick={close}
            className="sm:hidden p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav links */}
        <div className="flex-1 overflow-y-auto py-4">
          <ul className="space-y-1 px-3">
            {sidebarNavItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname?.startsWith(item.href));
              const Icon = item.icon;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={close} // auto-close on mobile after navigation
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all",
                      isActive
                        ? "bg-indigo-600 font-medium text-white shadow-sm"
                        : "hover:bg-slate-800 hover:text-white"
                    )}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="p-4 border-t border-slate-800 text-xs text-slate-500 text-center flex-shrink-0">
          © 2026 Admin Panel
        </div>
      </nav>
    </>
  );
}
