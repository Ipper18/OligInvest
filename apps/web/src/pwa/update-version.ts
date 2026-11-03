// Share the shell's browser validators instead of adding a second Zod chunk.
import { pwaWorkerVersionSchema } from "@oliginvest/contracts/browser";

function readVersion(worker: ServiceWorker): Promise<string | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (version: string | null) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      resolve(version);
    };
    // Older or terminated workers may not answer. Close the ports without offering an update.
    const timer = setTimeout(() => finish(null), 3000);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const parsed = pwaWorkerVersionSchema.safeParse(event.data);
      finish(parsed.success ? parsed.data.version : null);
    };
    channel.port1.onmessageerror = () => finish(null);
    try {
      worker.postMessage({ type: "GET_VERSION" }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

export async function hasNewVersion(controller: ServiceWorker, candidate: ServiceWorker) {
  const [active, waiting] = await Promise.all([readVersion(controller), readVersion(candidate)]);
  return active !== null && waiting !== null && active !== waiting;
}
