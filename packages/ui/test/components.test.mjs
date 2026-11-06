import { disclaimers } from "@oliginvest/i18n";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { expect, test } from "vitest";
import {
  AssumptionsBlock,
  Button,
  DataFreshness,
  Disclaimer,
  SelectField,
  TextField,
} from "../dist/index.js";

test("every disclaimer renders its exact versioned text and rejects an incorrect version", () => {
  for (const [key, entry] of Object.entries(disclaimers)) {
    const html = render(h(Disclaimer, { disclaimerKey: key, version: entry.version }));
    expect(html).toContain(entry.text);
    expect(html).toContain(`data-disclaimer-key="${key}"`);
    expect(html).toContain(`data-disclaimer-version="${entry.version}"`);
  }
  expect(() => render(h(Disclaimer, { disclaimerKey: "analysis", version: "old" }))).toThrow();
});

const meta = { source: "yahoo", asOf: "2026-09-18T13:42:00Z", delayMinutes: 20, stale: false };
test("quality warning is independent of freshness, while legacy holds retain BLOCK", () => {
  for (const qualityStatus of ["WARN", "BLOCK"]) {
    const html = render(h(DataFreshness, { meta: { ...meta, qualityStatus }, kind: "delayed" }));
    expect(html).toContain(qualityStatus);
  }
  const html = render(
    h(DataFreshness, {
      meta: { ...meta, stale: true, staleReason: "data_quality_hold" },
      kind: "delayed",
    }),
  );
  expect(html).toContain("BLOCK");
});

test("freshness preserves actual delay, source, exact time and all stale reasons", () => {
  const html = render(h(DataFreshness, { meta, kind: "delayed" }));
  expect(html).toContain("opóźnione ok. 20 min");
  expect(html).toContain("18 wrz 2026, 15:42");
  expect(html).toContain("yahoo");
  expect(html).not.toContain("nieaktualne");
  for (const staleReason of [
    "market_closed",
    "provider_error",
    "provider_quota",
    "provider_disabled",
    "no_data",
    "eod_only",
    "data_quality_hold",
    undefined,
  ]) {
    const stale = render(
      h(DataFreshness, { meta: { ...meta, stale: true, staleReason }, kind: "delayed" }),
    );
    expect(stale).toContain('role="status"');
    expect(stale).toContain("nieaktualne");
    expect(stale).toContain("18 wrz 2026, 15:42");
  }
});

test("EOD uses the supplied session date, not the user's calendar date", () => {
  const html = render(
    h(DataFreshness, {
      meta: { ...meta, asOf: "2026-09-19T01:00:00Z", delayMinutes: 0 },
      kind: "eod",
      sessionDate: "2026-09-18",
      timeZone: "Pacific/Auckland",
    }),
  );
  expect(html).toContain("zamknięcie 18.09.2026 · yahoo");
  expect(html).toMatch(/datetime="2026-09-18"/iu);
});

test("NBP copy cannot accidentally attribute a different provider to NBP", () => {
  const props = { meta: { ...meta, source: "nbp" }, kind: "fx", sessionDate: "2026-09-18" };
  expect(render(h(DataFreshness, props))).toContain("kurs średni NBP z 18.09.2026 (tabela A)");
  expect(() => render(h(DataFreshness, { ...props, meta }))).toThrow();
});

test("assumptions are initially open and keep a summary in the native disclosure", () => {
  const html = render(
    h(AssumptionsBlock, { summary: "Dane historyczne" }, h("p", null, "Szczegóły")),
  );
  expect(html).toContain("<details");
  expect(html).toContain('open=""');
  expect(html).toContain("Założenia tej analizy");
  expect(html).toMatch(/<summary[\s\S]*Dane historyczne[\s\S]*<\/summary>/);
});

test("native fields bind visible labels, help and errors; buttons do not submit by default", () => {
  const html = render(
    h(TextField, {
      id: "amount",
      label: "Cena",
      description: "Opis",
      error: "Błąd",
      "aria-describedby": "external",
      required: true,
      inputMode: "decimal",
    }),
  );
  expect(html).toContain('for="amount"');
  expect(html).toContain('aria-describedby="external amount-description amount-error"');
  expect(html).toContain('aria-invalid="true"');
  expect(
    render(
      h(SelectField, { id: "currency", label: "Waluta" }, h("option", { value: "PLN" }, "PLN")),
    ),
  ).toContain('for="currency"');
  expect(render(h(Button, null, "Zapisz"))).toContain('type="button"');
});

test("change badges distinguish signed gains, losses, neutral zero and missing/stale values", async () => {
  const { ChangeValue, MoneyValue, AllocationBar, RangeBar } = await import("../dist/index.js");
  for (const [amount, sign, icon, label] of [
    ["1.25", "+", "▲", "wzrost"],
    ["-1.25", "-", "▼", "spadek"],
  ]) {
    const html = render(h(ChangeValue, { value: amount, currency: "PLN" }));
    expect(html).toContain(`${sign}1,25`);
    expect(html).toContain(icon);
    expect(html).toContain(label);
    expect(html).toContain('aria-hidden="true"');
  }
  for (const amount of ["0", "-0.00"]) {
    const html = render(h(ChangeValue, { value: amount, currency: "PLN" }));
    expect(html).toContain("oi-flat");
    expect(html).not.toMatch(/▲|▼|oi-gain|oi-loss/);
  }
  for (const Component of [ChangeValue, MoneyValue]) {
    for (const props of [{ value: null }, { value: "0", stale: true }]) {
      const html = render(h(Component, { ...props, currency: "PLN" }));
      expect(html).toContain("—");
      expect(html).not.toContain("0,00");
    }
  }
  const bar = render(
    h(AllocationBar, {
      items: [
        { label: "PLN", weight: 0.75 },
        { label: "EUR", weight: 0.25 },
      ],
    }),
  );
  expect(bar).toContain("75,00%");
  expect(bar).toContain("EUR");
  expect(bar).toContain('aria-hidden="true"');
  // SSR style attributes are blocked by production CSP before hydration.
  expect(bar).not.toContain("style=");
  const range = render(h(RangeBar, { low: "8", high: "14", value: "12", currency: "PLN" }));
  expect(range).not.toContain("style=");
  expect(range).toContain("66,67%");
  expect(render(h(RangeBar, { low: "8", high: "14", value: null, currency: "PLN" }))).not.toContain(
    "<meter",
  );
});

test("live status reserves every label so hydration cannot change the toolbar width", async () => {
  const { LiveStatus } = await import("../dist/index.js");
  const html = render(
    h(LiveStatus, {
      label: "Łączenie",
      reserve: ["Na żywo", "Łączenie", "Wstrzymane"],
      actionLabel: "Wstrzymaj",
      actionName: "Wstrzymaj aktualizacje",
      onAction: () => {},
    }),
  );
  // The other labels occupy the same grid cell, hidden from assistive technology and from view.
  expect(html.match(/class="oi-connection-reserve"/g)).toHaveLength(2);
  expect(html).toContain('<span aria-hidden="true" class="oi-connection-reserve">Na żywo</span>');
  expect(html).toContain('<span class="oi-connection-current">Łączenie</span>');
  expect(html.split("Łączenie")).toHaveLength(2);
});
