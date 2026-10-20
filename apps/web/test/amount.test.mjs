import { expect, test } from "vitest";
import { Amount } from "../src/portfolio/presentation.tsx";

test("unknown costs have a distinct label while missing valuations stay unavailable", () => {
  expect(Amount({ value: null, unknownCost: true }).props.children).toBe("Koszt nieznany");
  expect(Amount({ value: null }).props.children).not.toBe("Koszt nieznany");
});

test("zero and negative zero stay neutral without converting money to float", () => {
  for (const amount of ["0", "0.00", "-0.00000000"])
    expect(
      Amount({ value: { amount, currency: "PLN" }, signed: true }).props.className,
    ).toBeUndefined();
  for (const [amount, color] of [
    ["0.01", "oi-gain"],
    ["-0.01", "oi-loss"],
  ])
    expect(Amount({ value: { amount, currency: "PLN" }, signed: true }).props.className).toBe(
      color,
    );
});
