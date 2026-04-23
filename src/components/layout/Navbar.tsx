"use client";

import { useSession, signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { LogOut, User, Menu, RefreshCw, BellRing, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "./SidebarContext";
import { useNavbarCount } from "./NavbarCountContext";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";

export function Navbar() {
  const { data: session } = useSession();
  const { toggle } = useSidebar();
  const { showingCount } = useNavbarCount();
  const [fcmWakePending, setFcmWakePending] = useState(false);
  const [fcmWakeState, setFcmWakeState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [fcmWakePingAll, setFcmWakePingAll] = useState(false);
  const [fcmWakeMsg, setFcmWakeMsg] = useState<string | null>(null);
  const pathname = usePathname();
  const restoreAttemptRef = useRef(0);

  const getScrollContainer = () =>
    (document.getElementById("dashboard-scroll-container") as HTMLElement | null) ??
    (document.scrollingElement as HTMLElement | null);

  const findTopVisibleAnchor = (container: HTMLElement) => {
    const anchors = Array.from(container.querySelectorAll<HTMLElement>("[data-scroll-anchor-id]"));
    if (anchors.length === 0) return null;
    const cRect = container.getBoundingClientRect();
    const cTop = cRect.top;

    // Find the first anchor that is (at least partially) visible.
    for (const el of anchors) {
      const r = el.getBoundingClientRect();
      if (r.bottom > cTop + 8) {
        const id = el.dataset.scrollAnchorId || "";
        if (!id) continue;
        const offsetPx = Math.round(r.top - cTop);
        return { id, offsetPx };
      }
    }
    return null;
  };

  const saveScrollPosition = () => {
    const el = getScrollContainer();
    const top = el ? el.scrollTop : 0;
    try {
      const token = String(Date.now());
      sessionStorage.setItem("dashboard:scrollPath", pathname || "");
      sessionStorage.setItem("dashboard:scrollTop", String(top));
      sessionStorage.setItem("dashboard:restoreToken", token);
      if (el) {
        const anchor = findTopVisibleAnchor(el);
        if (anchor) {
          sessionStorage.setItem("dashboard:scrollAnchorId", anchor.id);
          sessionStorage.setItem("dashboard:scrollAnchorOffsetPx", String(anchor.offsetPx));
        } else {
          sessionStorage.removeItem("dashboard:scrollAnchorId");
          sessionStorage.removeItem("dashboard:scrollAnchorOffsetPx");
        }
      }
      // Mark restore as pending so we keep trying after reload until stable.
      sessionStorage.setItem("dashboard:restorePending", token);
    } catch {
      /* ignore */
    }
  };

  const restoreScrollPosition = () => {
    let storedPath = "";
    let storedTop = "";
    let anchorId = "";
    let anchorOffsetPx = "";
    let restorePending = "";
    let restoreToken = "";
    try {
      storedPath = sessionStorage.getItem("dashboard:scrollPath") || "";
      storedTop = sessionStorage.getItem("dashboard:scrollTop") || "";
      anchorId = sessionStorage.getItem("dashboard:scrollAnchorId") || "";
      anchorOffsetPx = sessionStorage.getItem("dashboard:scrollAnchorOffsetPx") || "";
      restorePending = sessionStorage.getItem("dashboard:restorePending") || "";
      restoreToken = sessionStorage.getItem("dashboard:restoreToken") || "";
    } catch {
      return;
    }

    // Only restore when a refresh explicitly requested it.
    if (!restorePending || !storedTop) return;
    // Guard: pending must match the latest saved token.
    if (restoreToken && restorePending !== restoreToken) return;
    if (storedPath && pathname && storedPath !== pathname) return;

    const top = Number(storedTop);
    if (!Number.isFinite(top)) return;

    const el = getScrollContainer();
    if (!el) return;

    let targetTop = top;
    let usedAnchor = false;
    if (anchorId) {
      const anchorEl = el.querySelector<HTMLElement>(`[data-scroll-anchor-id="${CSS.escape(anchorId)}"]`);
      const offset = Number(anchorOffsetPx);
      if (anchorEl && Number.isFinite(offset)) {
        const cRect = el.getBoundingClientRect();
        const aRect = anchorEl.getBoundingClientRect();
        // Current scrollTop + delta between anchor and container top - desired offset
        targetTop = el.scrollTop + (aRect.top - cRect.top) - offset;
        usedAnchor = true;
      }
    }

    el.scrollTo({ top: Math.max(0, Math.round(targetTop)), behavior: "auto" });

    // If content height changes during refresh, keep retrying for a short window.
    // This avoids landing "nearby" (clamped) when list/table content loads after hydration.
    let aligned = false;
    if (usedAnchor) {
      const anchorEl = el.querySelector<HTMLElement>(`[data-scroll-anchor-id="${CSS.escape(anchorId)}"]`);
      const offset = Number(anchorOffsetPx);
      if (anchorEl && Number.isFinite(offset)) {
        const cRect = el.getBoundingClientRect();
        const aRect = anchorEl.getBoundingClientRect();
        aligned = Math.abs((aRect.top - cRect.top) - offset) <= 2;
      }
    } else {
      aligned = Math.abs(el.scrollTop - top) <= 2;
    }

    if (aligned) {
      try {
        // Clear only the pending flag so this restore runs once per refresh.
        // Keep the stored values so if layout shifts again during hydration,
        // our scheduled retries still have access to them.
        sessionStorage.removeItem("dashboard:restorePending");
      } catch {
        /* ignore */
      }
      return;
    }

    if (restoreAttemptRef.current < 40) {
      restoreAttemptRef.current += 1;
      window.setTimeout(() => restoreScrollPosition(), 80);
      return;
    }
  };

  useEffect(() => {
    restoreAttemptRef.current = 0;
    // Try immediately, then again after load/hydration settles.
    restoreScrollPosition();
    window.requestAnimationFrame(() => restoreScrollPosition());
    const t1 = window.setTimeout(() => restoreScrollPosition(), 250);
    const t2 = window.setTimeout(() => restoreScrollPosition(), 800);
    const t3 = window.setTimeout(() => restoreScrollPosition(), 1600);
    const t4 = window.setTimeout(() => restoreScrollPosition(), 2600);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const handleRefresh = async () => {
    setFcmWakePending(true);
    try {
      // Same FCM wake as Call Logs → Wake Devices (stale devices, 12h window).
      // Completes before reload so the request is not aborted by navigation.
      await fetch("/api/fcm-wake?hours=12", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      /* still refresh dashboard */
    }
    saveScrollPosition();
    // Do a real reload so *all* pages (including client-fetched ones like Call Logs)
    // actually refetch data, but restore scroll after reload via sessionStorage.
    window.location.reload();
  };

  const triggerFcmWake = async () => {
    setFcmWakeState("loading");
    setFcmWakeMsg(null);
    try {
      const params = fcmWakePingAll ? "all=1" : "hours=12";
      const res = await fetch(`/api/fcm-wake?${params}`, { method: "POST", credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setFcmWakeState("success");
        setFcmWakeMsg(json.message ?? "Sent");
      } else {
        setFcmWakeState("error");
        setFcmWakeMsg(json.error ?? "Failed");
      }
    } catch {
      setFcmWakeState("error");
      setFcmWakeMsg("Network error");
    }
    setTimeout(() => { setFcmWakeState("idle"); setFcmWakeMsg(null); }, 4000);
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
            type="button"
            onClick={handleRefresh}
            disabled={fcmWakePending}
            className={cn(
              "p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
            )}
            title="Refresh dashboard (sends FCM wake to stale devices, then reloads)"
          >
            <RefreshCw className={cn("w-4 h-4", fcmWakePending && "animate-spin")} />
          </button>
          {showingCount !== null && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1 text-xs">
              <span className="font-medium text-slate-400">Showing</span>
              <span className="font-semibold text-slate-100">{showingCount}</span>
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        {/* FCM Wake Controls */}
        <div className="hidden sm:flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={fcmWakePingAll}
              onChange={(e) => setFcmWakePingAll(e.target.checked)}
              className="rounded border-slate-600 bg-slate-900 accent-indigo-500"
            />
            Ping all
          </label>
          {fcmWakeMsg && (
            <span className={cn(
              "text-xs px-2 py-1 rounded-full border flex items-center gap-1.5",
              fcmWakeState === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-rose-500/30 bg-rose-500/10 text-rose-400"
            )}>
              {fcmWakeState === "success"
                ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                : <XCircle className="w-3.5 h-3.5 shrink-0" />}
              {fcmWakeMsg}
            </span>
          )}
          <button
            onClick={triggerFcmWake}
            disabled={fcmWakeState === "loading"}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all duration-200",
              fcmWakeState === "loading"
                ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed"
                : fcmWakeState === "success"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : fcmWakeState === "error"
                ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                : "bg-indigo-600/10 border-indigo-500/30 text-indigo-400 hover:bg-indigo-600/20 hover:border-indigo-400/50 hover:text-indigo-300"
            )}
          >
            {fcmWakeState === "loading"
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <BellRing className="w-3.5 h-3.5" />}
            {fcmWakeState === "loading" ? "Sending..." : "Wake Devices"}
          </button>
        </div>

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
