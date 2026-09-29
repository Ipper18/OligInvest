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
