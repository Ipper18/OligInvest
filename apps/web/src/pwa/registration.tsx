"use client";
import { safeReturnTo } from "@oliginvest/contracts/navigation";

import { pwaMessages } from "@oliginvest/i18n";
import { useEffect, useState } from "react";
import { clearPrivateState } from "../auth/logout";
export function PwaRegistration() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let disposed = false,
      registration: ServiceWorkerRegistration | undefined;
    const update = () => {
      if (!disposed && registration?.waiting && navigator.serviceWorker.controller)
        setWaiting(registration.waiting);
    };
    const found = () => registration?.installing?.addEventListener("statechange", update);
    const precache = () =>
      navigator.serviceWorker.controller?.postMessage({
        type: "CACHE_STATIC",
        urls: performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .slice(0, 100),
      });
    const unauthorized = (event: MessageEvent) => {
      if (event.data?.type === "UNAUTHORIZED")
        void clearPrivateState().finally(() =>
          location.replace(
            `/logowanie?${new URLSearchParams({ returnTo: safeReturnTo(location.pathname + location.search) })}`,
          ),
        );
    };
    const refresh = () => {
      if (document.visibilityState === "visible") void registration?.update().catch(() => {});
    };
    navigator.serviceWorker.addEventListener("controllerchange", precache);
    navigator.serviceWorker.addEventListener("message", unauthorized);
    document.addEventListener("visibilitychange", refresh);
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((value) => {
        if (disposed) return;
        registration = value;
        registration.addEventListener("updatefound", found);
        update();
        precache();
      })
      .catch(() => {});
    return () => {
      disposed = true;
      registration?.removeEventListener("updatefound", found);
      navigator.serviceWorker.removeEventListener("controllerchange", precache);
      navigator.serviceWorker.removeEventListener("message", unauthorized);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  if (!waiting) return null;
  return (
    <div role="status">
      <span>{pwaMessages.update}</span>
      <button
        type="button"
        className="oi-button"
        onClick={() => {
          navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), {
            once: true,
          });
          waiting.postMessage({ type: "ACTIVATE_UPDATE" });
        }}
      >
        {pwaMessages.refresh}
      </button>
    </div>
  );
}
