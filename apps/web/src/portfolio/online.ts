import { useSyncExternalStore } from "react";

function subscribe(notify: () => void) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}
const snapshot = () => navigator.onLine;
const serverSnapshot = () => true;
export const useOnline = () => useSyncExternalStore(subscribe, snapshot, serverSnapshot);
