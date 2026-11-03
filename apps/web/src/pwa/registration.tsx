"use client";
import { pwaMessages } from "@oliginvest/i18n";
import { useEffect, useState } from "react";
export function PwaRegistration() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let disposed = false,
      registration: ServiceWorkerRegistration | undefined;
    const listeners = new Map<ServiceWorker, () => void>();
    const update = (controller: ServiceWorker | null) => {
      const candidate = registration?.waiting;
      if (disposed) return;
      if (!controller || !candidate) {
        setWaiting(null);
        return;
      }
      // Load validation only for an actual waiting worker, outside normal route JS budgets.
      void import("./update-version")
        .then(({ hasNewVersion }) => hasNewVersion(controller, candidate))
        .then((different) => {
          if (!disposed && registration?.waiting === candidate)
            setWaiting(different ? candidate : null);
        })
        .catch(() => {});
    };
    const watch = (controller: ServiceWorker | null) => {
      const installing = registration?.installing;
      if (!installing || listeners.has(installing)) return;
      const changed = () => update(controller);
      listeners.set(installing, changed);
      installing.addEventListener("statechange", changed);
    };
    const found = () => watch(navigator.serviceWorker.controller);
    const precache = () =>
      navigator.serviceWorker.controller?.postMessage({
        type: "CACHE_STATIC",
        urls: performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .slice(0, 100),
      });
    const refresh = () => {
      if (document.visibilityState === "visible") void registration?.update().catch(() => {});
    };
    navigator.serviceWorker.addEventListener("controllerchange", precache);
    document.addEventListener("visibilitychange", refresh);
    // Capture before register(): clients.claim() may supply a controller during first install.
    const previousController = navigator.serviceWorker.controller;
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((value) => {
        if (disposed) return;
        registration = value;
        registration.addEventListener("updatefound", found);
        watch(previousController);
        update(previousController);
        precache();
      })
      .catch(() => {});
    return () => {
      disposed = true;
      registration?.removeEventListener("updatefound", found);
      for (const [worker, changed] of listeners) worker.removeEventListener("statechange", changed);
      navigator.serviceWorker.removeEventListener("controllerchange", precache);
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
