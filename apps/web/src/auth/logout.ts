const listeners = new Set<() => void>();
export function onLogout(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export async function clearPrivateState(broadcast = true) {
  for (const listener of listeners) listener();
  if (broadcast && typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("oliginvest-session");
    channel.postMessage("logout");
    channel.close();
  }
  if ("caches" in window) await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
  if ("indexedDB" in window && indexedDB.databases)
    for (const db of await indexedDB.databases()) if (db.name) indexedDB.deleteDatabase(db.name);
}
