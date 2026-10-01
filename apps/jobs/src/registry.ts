import { JobsModuleRegistry, ModuleCatalog, type QueueDef } from "@oliginvest/platform";

export function createQueueRegistry() {
  const definitions = [
    { id: "market", queues: [{ name: "ingest", concurrency: 2 }] },
    {
      id: "portfolio",
      queues: [
        { name: "import", concurrency: 1 },
        { name: "recompute", concurrency: 2 },
      ],
    },
    { id: "alerts", queues: [{ name: "alerts", concurrency: 2 }] },
    { id: "notifications", queues: [{ name: "notify", concurrency: 4 }] },
    {
      id: "analytics",
      queues: [
        { name: "analytics", concurrency: 1 },
        { name: "analytics-results", concurrency: 2 },
      ],
    },
  ];
  const catalog = new ModuleCatalog(
    definitions.map(({ id }) => {
      const feature = id === "analytics" || id === "alerts";
      return {
        id,
        layer: feature ? "feature" : "foundation",
        version: "1.0.0",
        permissions: [],
        ...(feature ? { featureFlag: `module.${id}` } : {}),
      };
    }),
  );
  const registry = new JobsModuleRegistry(catalog);
  for (const definition of definitions)
    registry.register({ ...definition, handlers: {}, schedules: [] });
  const queues: readonly QueueDef[] = Object.freeze([
    ...registry.entries().flatMap(({ queues }) => queues),
    Object.freeze({ name: "events", concurrency: 4 }),
  ]);
  return { registry, queues };
}
