import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync(new URL("../src/tokens.css", import.meta.url), "utf8");
const document = readFileSync(
  new URL("../../../docs/04-frontend/system-projektowy.md", import.meta.url),
  "utf8",
);
function colors(block) {
  return Object.fromEntries(
    [...block.matchAll(/--color-([\w-]+):\s*(#[\da-f]{6})/gi)].map(([, name, value]) => [
      name,
      value.toLowerCase(),
    ]),
  );
}
const dark = colors(css.split(":root")[0]);
const light = colors(css.match(/:root\[data-theme="light"\]\s*\{([^}]+)\}/)[1]);
const system = colors(
  css.match(
    /@media \(prefers-color-scheme: light\)\s*\{\s*:root\[data-theme="system"\]\s*\{([^}]+)\}/,
  )[1],
);

function luminance(hex) {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((value) => {
      const c = Number.parseInt(value, 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

test("semantic color tokens agree with the design source, and system light matches explicit light", () => {
  const rows = [
    ...document.matchAll(/\| `--color-([\w-]+)` \| `(#[\da-f]{6})` \|[^|]+\| `(#[\da-f]{6})`/gi),
  ];
  expect(rows.length).toBe(12);
  for (const [, name, darkValue, lightValue] of rows) {
    expect(dark[name]).toBe(darkValue.toLowerCase());
    expect(light[name]).toBe(lightValue.toLowerCase());
  }
  expect(system).toEqual(light);
});

test("both themes and palettes meet text and graphical contrast thresholds", () => {
  for (const palette of [dark, light]) {
    for (const surface of [palette.bg, palette.panel]) {
      for (const name of [
        "ink",
        "muted",
        "accent",
        "warning",
        "danger",
        "gain",
        "loss",
        "gain-accessible",
        "loss-accessible",
      ])
        expect(contrast(palette[name], surface), `${name} on ${surface}`).toBeGreaterThanOrEqual(
          4.5,
        );
      for (const name of [
        "border",
        "focus",
        ...Array.from({ length: 8 }, (_, i) => `category-${i + 1}`),
      ])
        expect(contrast(palette[name], surface), `${name} on ${surface}`).toBeGreaterThanOrEqual(3);
    }
  }
  expect(css).not.toMatch(/@font-face|https?:\/\/|@import/);
});
