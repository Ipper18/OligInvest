const listeners = new Set<() => void>();
const source = crypto.randomUUID();
export function onRemoteLogout(listener: () => void) {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel("oliginvest-session");
  channel.onmessage = (event) => {
    if (event.data?.type === "logout" && event.data.source !== source) listener();
  };
  return () => channel.close();
}
export function onLogout(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export async function clearPrivateState({ broadcast = false, unsubscribePush = false } = {}) {
  for (const listener of listeners) listener();
  if (broadcast && typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("oliginvest-session");
    channel.postMessage({ type: "logout", source });
    channel.close();
  }
  if ("caches" in window)
    await Promise.all(
      (await caches.keys())
        .filter((key) => !key.startsWith("oliginvest-static-"))
        .map((key) => caches.delete(key)),
    );
  if ("indexedDB" in window && indexedDB.databases)
    for (const db of await indexedDB.databases()) if (db.name) indexedDB.deleteDatabase(db.name);
  if ("serviceWorker" in navigator) {
    // Cleanup may outlive the page. Never make navigation wait for the worker or push service.
    const message = { type: "CLEAR_PRIVATE", unsubscribePush };
    if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage(message);
    else
      void navigator.serviceWorker
        .getRegistration()
        .then((registration) => registration?.active?.postMessage(message))
        .catch(() => {});
  }
}
