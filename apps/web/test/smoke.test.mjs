import { messages } from "@oliginvest/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import TestPage from "../src/app/page.tsx";

vi.mock("../src/api/server", () => ({ getHealthStatus: async () => "ok" }));
vi.mock("../src/appearance/preferences", () => ({
  getTestPreferences: async () => ({ theme: "dark", palette: "standard" }),
}));

test("test page renders messages from the shared dictionary", async () => {
  const html = renderToStaticMarkup(await TestPage());
  expect(html).toContain(messages.bootstrap.title);
  expect(html).toContain(messages.bootstrap.description);
});
