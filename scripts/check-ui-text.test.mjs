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

test("nested conditional JSX keeps technical attributes distinct from text", (t) => {
  const root = fixture(
    t,
    "apps/web/src/page.tsx",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Source fixture for technical template attributes.
    'export const Page = () => <p>{ok && <span className="hint" id={`${id}-help`}>{messages.hint}</span>}</p>;',
  );
  assert.deepEqual(checkUiText(root), []);
});
