"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Fires POST /api/sync once on mount. Rendered conditionally by the dashboard
 * when the last sync is stale (>23h). If the user keeps the tab open, this
 * does not re-fire because the component only mounts once per page load.
 *
 * Failures (rate limit, network) are swallowed silently — the manual button
 * remains the user-visible escape hatch.
 */
export function AutoSync() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/sync", { method: "POST" });
        if (cancelled) return;
        if (r.ok) {
          router.refresh();
        }
      } catch {
        // ignore — manual sync button handles user-visible retries
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);
  return null;
}
