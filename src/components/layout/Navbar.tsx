"use client";

import { useSession, signOut } from "next-auth/react";
import { LogOut, User, Menu, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "./SidebarContext";

export function Navbar() {
  const { data: session } = useSession();
  const { toggle } = useSidebar();

  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <header className="h-16 flex items-center justify-between px-4 sm:px-6 bg-slate-900 border-b border-slate-800 shadow-sm z-20 w-full text-slate-100 flex-shrink-0">
      <div className="flex items-center gap-3">
        {/* Hamburger — only visible on mobile */}
        <button
          onClick={toggle}
          className="sm:hidden p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2">
          <span className="font-medium text-lg text-slate-400">Dashboard</span>
          <button
            onClick={handleRefresh}
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Refresh Dashboard"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        {session?.user && (
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-2 bg-slate-800 px-2.5 sm:px-3 py-1.5 rounded-full border border-slate-700">
              <User className="w-4 h-4 text-indigo-400 flex-shrink-0" />
              <div className="flex flex-col leading-none">
                <span className="text-sm font-medium truncate max-w-[100px] sm:max-w-none">
                  {session.user.name || "Admin"}
                </span>
                <span className="text-xs text-slate-400 uppercase tracking-wider hidden sm:block">
                  {session.user.role}
                </span>
              </div>
            </div>

            <Button
              variant="default"
              size="sm"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="bg-slate-800 hover:bg-rose-600 text-slate-200 border border-slate-700 hover:border-transparent transition-colors"
            >
              <LogOut className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
