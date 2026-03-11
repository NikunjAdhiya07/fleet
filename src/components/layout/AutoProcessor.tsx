"use client";

import { useEffect, useRef } from "react";

/**
 * Silently pings the contact intelligence processing pipeline in the background
 * every 15 seconds while the dashboard is open. Doing this handles newly
 * synced calls from external legacy backends without relying on webhooks or Cron jobs.
 */
export function AutoProcessor() {
  const hasPinged = useRef(false);

  useEffect(() => {
    const pingTrigger = async () => {
      try {
        await fetch("/api/contact-intelligence/process", {
          method: "GET",
          headers: { "Cache-Control": "no-cache" }
        });
      } catch (e) {
        // silent fail
      }
    };

    // Ping once on load
    if (!hasPinged.current) {
      pingTrigger();
      hasPinged.current = true;
    }

    // Then interval every 10 seconds
    const interval = setInterval(pingTrigger, 10000);
    return () => clearInterval(interval);
  }, []);

  return null;
}
