import { registerHooks } from "node:module";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

// Observe the real import without preloading dependencies or changing resolution.
// Native load timings exclude compilation/evaluation and Vite RPC/transform waits.
export async function profileServerImport(runner) {
  const loads = new Map();
  const hook = registerHooks({
    load(url, context, nextLoad) {
      const started = performance.now();
      try {
        return nextLoad(url, context);
      } finally {
        loads.set(url, performance.now() - started);
      }
    },
  });
  const started = performance.now();
  const cpuStarted = process.cpuUsage();
  let loaded;
  try {
    loaded = await import("@oliginvest/mod-quick-actions/server");
  } finally {
    hook.deregister();
    const cpu = process.cpuUsage(cpuStarted);
    console.info(
      `[quick-import:${runner}] cold wall=${Math.round(performance.now() - started)}ms worker-cpu=${Math.round((cpu.user + cpu.system) / 1000)}ms native-loads=${loads.size} native-load=${Math.round([...loads.values()].reduce((sum, value) => sum + value, 0))}ms`,
    );
    for (const [name, fragment] of [
      ["i18n", "/packages/i18n/"],
      ["market-contracts", "/modules/market/dist/src/contracts.js"],
      ["zod-openapi", "/node_modules/@hono/zod-openapi/"],
    ]) {
      const entries = [...loads].filter(([url]) => url.includes(fragment));
      console.info(
        `[quick-import:${runner}] ${name} native-loads=${entries.length} native-load=${Math.round(entries.reduce((sum, [, duration]) => sum + duration, 0))}ms`,
      );
    }
  }
  const warmStarted = performance.now();
  await import("@oliginvest/mod-quick-actions/server");
  console.info(
    `[quick-import:${runner}] cached wall=${Math.round(performance.now() - warmStarted)}ms`,
  );
  return loaded;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await profileServerImport("node");
}
