import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { checkUiText, forbiddenMatches } from "./check-ui-text.mjs";

const policy = JSON.parse(
  readFileSync(
    new URL("../packages/i18n/src/compliance/forbidden-phrases.pl.json", import.meta.url),
    "utf8",
  ),
);
function fixture(t, path, content) {
  const root = mkdtempSync(join(tmpdir(), "oliginvest-text-"));
  t.after(() => {
    assert.ok(
      resolve(root).startsWith(`${resolve(tmpdir())}\\oliginvest-text-`) ||
        resolve(root).startsWith(`${resolve(tmpdir())}/oliginvest-text-`),
    );
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
  return root;
}

test("whole Polish words, case, Unicode and whitespace; no substring false positives", () => {
  for (const text of [
    "KUP!",
    "„sprzedaj”",
    "sygnał\nSPRZEDAŻY",
    "OPTYMALNY\u00a0PORTFEL",
    "warto",
    "Łokazja okazja.",
  ])
    assert.ok(forbiddenMatches(text, policy).length);
  for (const text of [
    "Kupno",
    "Sprzedaż",
    "wartość",
    "pewnego",
    "zakup",
    "okazjach",
    "niepewne",
    "Zapisz",
    "Zaimportuj plik",
  ])
    assert.deepEqual(forbiddenMatches(text, policy), []);
});

for (const jsx of [
  "<p>Zapisz</p>",
  '<p>{"Zapisz"}</p>',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Source fixture for the JSX parser.
  "<p>{`Wynik ${value}`}</p>",
  '<input aria-label="Cena"/>',
  '<input placeholder={"Cena"}/>',
  '<p>{ok ? "Tak" : "Nie"}</p>',
  '<p>{ok && "Tak"}</p>',
  '<Button title={formatMessage("Tytuł", {})}/>',
  '<ModalDialog triggerLabel="Otwórz" closeLabel="Zamknij"/>',
  '<TextField error="Podaj wartość"/>',
]) {
  test(`rejects JSX literal: ${jsx}`, (t) => {
    const root = fixture(t, "apps/web/src/page.tsx", `export const Page = () => (${jsx});`);
    assert.match(checkUiText(root).join("\n"), /jsx-literal/);
  });
}

test("allows technical attributes, dictionary keys, callbacks, whitespace and punctuation", (t) => {
  const root = fixture(
    t,
    "apps/web/src/page.tsx",
    'export const Page = () => <main id="content" className="panel" role="main"><p>{messages["title"]}{" · "}{ok ? messages.yes : messages.no}</p><input type="text" onChange={() => save("value")} aria-label={messages.label}/></main>;',
  );
  assert.deepEqual(checkUiText(root), []);
});

for (const [path, text] of [
  ["packages/i18n/src/pl/new.json", '{"message":"Kup"}'],
  ["modules/education/src/lesson.mdx", "# Optymalny portfel"],
  ["modules/education/src/italic.mdx", "_Kup_"],
  ["modules/education/src/bold.mdx", "**Optymalny** portfel"],
  [
    "packages/ui/src/bad.tsx",
    'const message = "Sprzedaj"; export const Page = () => <p>{message}</p>;',
  ],
  ["packages/ui/src/split.tsx", "export const Page = () => <p>Optymalny <b>portfel</b></p>;"],
  ["packages/i18n/src/pl/disclaimers.json", '{"unexpected":{"text":"Kup"}}'],
])
  test(`scans ${path}`, (t) =>
    assert.match(checkUiText(fixture(t, path, text)).join("\n"), /forbidden-phrase/));

test("only the documented disclaimer keys have a reasoned exception", (t) => {
  assert.ok(policy.exceptions.every((entry) => entry.reason.trim().length > 20));
  const root = fixture(
    t,
    "packages/i18n/src/pl/disclaimers.json",
    '{"general":{"text":"Nie kup"}}',
  );
  assert.deepEqual(checkUiText(root), []);
});

for (const [path, text] of [
  ["packages/i18n/src/en/new.json", '{"message":"Buy"}'],
  ["packages/i18n/src/en/new.json", '{"message":"The price will reach 120"}'],
  ["packages/i18n/src/en/new.json", '{"nested":{"message":"We recommend a guaranteed return"}}'],
  ["packages/i18n/src/en/disclaimers.json", '{"unexpected":{"text":"Sell"}}'],
  [
    "packages/i18n/src/en/education-content.json",
    '[{"key":"akcja","definition":"Profit is guaranteed"}]',
  ],
  ["packages/i18n/src/en/new.json", '{"message":"Kup"}'],
])
  test(`scans English dictionary ${path}: ${text}`, (t) =>
    assert.match(checkUiText(fixture(t, path, text)).join("\n"), /forbidden-phrase/));

test("English exceptions cover only listed disclaimers and glossary pitfalls by entry key", (t) => {
  assert.deepEqual(
    checkUiText(
      fixture(
        t,
        "packages/i18n/src/en/disclaimers.json",
        '{"general":{"text":"No recommendation"}}',
      ),
    ),
    [],
  );
  assert.deepEqual(
    checkUiText(
      fixture(
        t,
        "packages/i18n/src/en/education-content.json",
        '[{"key":"bb","pitfalls":"Not a guaranteed range"}]',
      ),
    ),
    [],
  );
  // The same text at another glossary entry is not covered by an exception.
  assert.match(
    checkUiText(
      fixture(
        t,
        "packages/i18n/src/en/education-content.json",
        '[{"key":"other","pitfalls":"Not a guaranteed range"}]',
      ),
    ).join("\n"),
    /forbidden-phrase: guaranteed/,
  );
});

test("the English list does not apply to Polish dictionaries or technical code literals", (t) => {
  assert.deepEqual(checkUiText(fixture(t, "packages/i18n/src/pl/new.json", '{"code":"hold"}')), []);
  assert.deepEqual(
    checkUiText(
      fixture(
        t,
        "modules/portfolio/src/side.ts",
        'export const side = (type: string) => (type === "buy" ? 1 : -1);',
      ),
    ),
    [],
  );
});

test("nested conditional JSX keeps technical attributes distinct from text", (t) => {
  const root = fixture(
    t,
    "apps/web/src/page.tsx",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Source fixture for technical template attributes.
    'export const Page = () => <p>{ok && <span className="hint" id={`${id}-help`}>{messages.hint}</span>}</p>;',
  );
  assert.deepEqual(checkUiText(root), []);
});
