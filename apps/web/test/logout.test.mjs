import { afterEach, expect, it, vi } from "vitest";
import { clearPrivateState } from "../src/auth/logout.ts";

afterEach(() => vi.unstubAllGlobals());
function environment(controller) {
  const getRegistration = vi.fn(() => new Promise(() => {}));
  vi.stubGlobal("navigator", { serviceWorker: { controller, getRegistration } });
  vi.stubGlobal("window", { caches: {} });
  const remove = vi.fn(async () => true);
  vi.stubGlobal("caches", {
    keys: async () => ["private", "oliginvest-static-build"],
    delete: remove,
  });
  vi.stubGlobal("BroadcastChannel", undefined);
  return { remove, getRegistration };
}
it("finishes local cleanup even when worker registration never resolves", async () => {
  const { remove, getRegistration } = environment(null);
  await clearPrivateState({ unsubscribePush: true });
  expect(remove).toHaveBeenCalledExactlyOnceWith("private");
  expect(getRegistration).toHaveBeenCalledOnce();
});
it("expiry preserves push; explicit and remote logout request unsubscribe without awaiting a worker", async () => {
  const postMessage = vi.fn();
  environment({ postMessage });
  await clearPrivateState();
  expect(postMessage).toHaveBeenLastCalledWith({ type: "CLEAR_PRIVATE", unsubscribePush: false });
  await clearPrivateState({ unsubscribePush: true });
  expect(postMessage).toHaveBeenLastCalledWith({ type: "CLEAR_PRIVATE", unsubscribePush: true });
});
