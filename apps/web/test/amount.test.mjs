import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Amount } from "../src/portfolio/presentation.tsx";

test("unknown costs have a distinct label while missing valuations stay unavailable", () => {
  expect(renderToStaticMarkup(createElement(Amount, { value: null, unknownCost: true }))).toContain(
    "Koszt nieznany",
  );
  expect(renderToStaticMarkup(createElement(Amount, { value: null }))).not.toContain(
    "Koszt nieznany",
  );
});

test("zero stays neutral and changes include text, signs and arrows without money conversion", () => {
  const html = (amount) =>
    renderToStaticMarkup(
      createElement(Amount, { value: { amount, currency: "PLN" }, signed: true }),
    );
  for (const amount of ["0", "0.00", "-0.00000000"]) {
    expect(html(amount)).toContain("oi-flat");
    expect(html(amount)).not.toMatch(/▲|▼/);
  }
  expect(html("0.01")).toContain("▲ +0,01");
  expect(html("-0.01")).toContain("▼ -0,01");
});
