import { randomUUID } from "node:crypto";
import {
  ApiModuleRegistry,
  createBoundaryHandler,
  JobsModuleRegistry,
  ModuleCatalog,
  UiModuleRegistry,
} from "@oliginvest/platform/modules";
import { expect, test } from "vitest";
import { z } from "zod";

const descriptor = (id = "education") => ({
  id,
  layer: "feature",
  version: "1.0.0",
  featureFlag: `module.${id}`,
  permissions: [{ key: `${id}:use`, roles: ["user", "pro", "admin"] }],
});
const subject = { userId: randomUUID(), role: "user" };
function setup() {
  let enabled = false;
  const metadata = descriptor();
  return {
    metadata,
    catalog: new ModuleCatalog([metadata], () => enabled),
    enable: () => {
      enabled = true;
    },
  };
}
test("strict catalog rejects duplicates and inconsistent flags/layers/permissions", () => {
  const metadata = descriptor();
  for (const entries of [
    [metadata, metadata],
    [{ ...metadata, extra: true }],
    [{ ...metadata, featureFlag: "module.alerts" }],
    [{ ...metadata, layer: "foundation" }],
    [{ ...metadata, permissions: [{ key: "education:use", roles: ["owner"] }] }],
  ]) {
    expect(() => new ModuleCatalog(entries)).toThrow();
  }
  const catalog = new ModuleCatalog([metadata]);
  return expect(catalog.isEnabled("education", subject)).resolves.toBe(false);
});
test("API checks flags on every lookup, emits NOT_FOUND, validates definition and duplicates", async () => {
  const { catalog, metadata, enable } = setup();
  const api = new ApiModuleRegistry(catalog);
  const routes = () => {};
  api.register({ ...metadata, routes });
  await expect(api.require("education", subject)).rejects.toMatchObject({ code: "NOT_FOUND" });
  enable();
  expect((await api.require("education", subject)).routes).toBe(routes);
  await expect(api.require("missing", subject)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(() => api.register({ ...metadata, routes })).toThrow(/Duplicate/);
  expect(() =>
    new ApiModuleRegistry(catalog).register({ ...metadata, version: "2.0.0", routes }),
  ).toThrow(/metadata/);
});
test("foundation always enabled and admin restricted to admin without a feature flag", async () => {
  const catalog = new ModuleCatalog(
    [
      { id: "identity", layer: "foundation", version: "1.0.0", permissions: [] },
      { id: "admin", layer: "feature", version: "1.0.0", permissions: [] },
    ],
    () => false,
  );
  expect(await catalog.isEnabled("identity", {})).toBe(true);
  expect(await catalog.isEnabled("admin", subject)).toBe(false);
  expect(await catalog.isEnabled("admin", { role: "admin" })).toBe(true);
});
test("jobs skip disabled handlers, subscriptions and schedules; enabled payload is validated", async () => {
  const { catalog, enable } = setup();
  const jobs = new JobsModuleRegistry(catalog);
  const calls = [];
  const handler = createBoundaryHandler({ v: z.literal(1) }, async (value, context) => {
    calls.push([value, context.requestId]);
  });
  jobs.register({
    id: "education",
    queues: [{ name: "education", concurrency: 1 }],
    handlers: { "education.test": handler },
    subscriptions: { "education.changed": handler },
    schedules: [{ job: "education.test", cron: "0 0 * * *", tz: "Europe/Warsaw" }],
  });
  const context = { requestId: randomUUID(), ...subject };
  expect(await jobs.dispatch("education", "education.test", { v: 1 }, context)).toBe("skipped");
  expect(await jobs.dispatchEvent("education", "education.changed", { v: 1 }, context)).toBe(
    "skipped",
  );
  expect(await jobs.schedules(subject)).toEqual([]);
  enable();
  await expect(
    jobs.dispatch("education", "education.test", { v: 1, unknown: true }, context),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  expect(await jobs.dispatch("education", "education.test", { v: 1 }, context)).toBe("handled");
  expect(await jobs.dispatchEvent("education", "education.changed", { v: 1 }, context)).toBe(
    "handled",
  );
  expect(calls).toEqual([
    [{ v: 1 }, context.requestId],
    [{ v: 1 }, context.requestId],
  ]);
  expect(await jobs.schedules(subject)).toHaveLength(1);
  expect(() => jobs.register({ id: "education", queues: [], handlers: {} })).toThrow(/Duplicate/);
});
test("UI applies flags and roles and never loads lazy admin panels", async () => {
  const { catalog, enable } = setup();
  const ui = new UiModuleRegistry(catalog);
  let loaded = false;
  const item = { href: "/education", labelKey: "education.title", permission: "education:use" };
  ui.register({
    id: "education",
    nav: [item],
    adminPanels: [
      {
        id: "education-settings",
        labelKey: "education.settings",
        load: async () => {
          loaded = true;
        },
      },
    ],
  });
  expect(await ui.navigation(subject)).toEqual([]);
  enable();
  expect(await ui.navigation(subject)).toEqual([item]);
  expect(await ui.navigation({})).toEqual([]);
  expect(await ui.adminPanels(subject)).toEqual([]);
  expect(await ui.adminPanels({ role: "admin" })).toHaveLength(1);
  expect(loaded).toBe(false);
});

test("metadata is copied/frozen and later flag changes apply to all registries", async () => {
  const metadata = descriptor();
  let enabled = true;
  const catalog = new ModuleCatalog([metadata], () => enabled);
  metadata.permissions[0].roles.splice(0);
  expect(catalog.hasPermission("education", "education:use", subject)).toBe(true);
  expect(() => catalog.get("education").permissions.push({ key: "unsafe", roles: [] })).toThrow();
  const api = new ApiModuleRegistry(catalog);
  api.register({ ...catalog.get("education"), routes: () => {} });
  expect(await api.require("education", subject)).toBeDefined();
  enabled = false;
  await expect(api.require("education", subject)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(catalog.isEnabled("education", { role: "owner" })).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
});

test("jobs reject unvalidated callbacks, unknown fields, invalid queues, schedules and context", async () => {
  const { catalog, enable } = setup();
  const handler = createBoundaryHandler({ v: z.literal(1) }, async () => {});
  const definition = { id: "education", queues: [], handlers: { "education.test": handler } };
  const invalid = [
    { ...definition, unexpected: true },
    { ...definition, handlers: { "education.test": async () => {} } },
    { ...definition, queues: [{ name: "education", concurrency: 0 }] },
    {
      ...definition,
      schedules: [{ job: "education.missing", cron: "0 0 * * *", tz: "Europe/Warsaw" }],
    },
    {
      ...definition,
      schedules: [{ job: "education.test", cron: "0 0 * * *", tz: "Invalid/Timezone" }],
    },
  ];
  for (const entry of invalid)
    expect(() => new JobsModuleRegistry(catalog).register(entry)).toThrow();
  const jobs = new JobsModuleRegistry(catalog);
  jobs.register(definition);
  enable();
  await expect(
    jobs.dispatch("education", "education.test", { v: 1 }, { requestId: "bad" }),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  expect(await jobs.dispatch("education", "toString", {}, { requestId: randomUUID() })).toBe(
    "skipped",
  );
});

test("UI rejects unknown modules, permissions, external hrefs and duplicate panels", () => {
  const { catalog } = setup();
  const item = { href: "/education", labelKey: "education.title", permission: "education:use" };
  for (const definition of [
    { id: "missing", nav: [] },
    { id: "education", nav: [{ ...item, permission: "portfolio:write" }] },
    { id: "education", nav: [{ ...item, href: "//example.test" }] },
    { id: "education", nav: [], unknown: true },
  ])
    expect(() => new UiModuleRegistry(catalog).register(definition)).toThrow();
  const panel = { id: "education-panel", labelKey: "education.panel", load: async () => null };
  expect(() =>
    new UiModuleRegistry(catalog).register({ id: "education", adminPanels: [panel, panel] }),
  ).toThrow(/Duplicate/);
});
