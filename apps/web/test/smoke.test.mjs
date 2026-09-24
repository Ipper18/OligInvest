import { messages } from "@oliginvest/i18n";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import TestPage from "../src/app/page.tsx";

test("test page renders messages from the shared dictionary", () => {
  const html = renderToStaticMarkup(createElement(TestPage));
  expect(html).toContain(messages.bootstrap.title);
  expect(html).toContain(messages.bootstrap.description);
});
