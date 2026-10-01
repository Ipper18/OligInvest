import assert from "node:assert/strict";
import test from "node:test";
import { checkDocumentation, expandIds } from "./check-docs.mjs";

const purpose = "# Dokument\n\n**Cel:** sprawdzić dokumentację.\n\n";
function fixture() {
  return new Map([
    ["docs/00-przeglad/wymagania.md", purpose + "| FR-01.01 | Wymaganie |\n| NFR-01.01 | Wymaganie |"],
    ["docs/08-plan/backlog.md", purpose + "| BL-001 | Zadanie `a|b` | FR-01.01, NFR-01.01 | DOC | — | 1 | todo |"],
    ["docs/00-przeglad/macierz-pokrycia.md", purpose + "| FR-01.01 | Opis | P0 | DOC | BL-001 | M0 | ✅ |\n| NFR-01.01 | Opis | P0 | DOC | BL-001 | M0 | ✅ |"],
    ["docs/example.md", purpose + "[wymagania](00-przeglad/wymagania.md#sekcja)\n[plik][ref]\n\n[ref]: <../some%20file.json> \"Tytuł\"\n[www](https://example.org/path)\n```md\n[przykład](missing.md)\n```"],
  ]);
}
function check(docs) {
  return checkDocumentation(docs, new Set([...docs.keys(), "some file.json"]));
}

test("accepts complete coverage, code-span pipes, links, references and fenced examples", () => {
  assert.deepEqual(check(fixture()), []);
});
test("expands full requirement ranges and abbreviated task ranges", () => {
  assert.deepEqual([...expandIds("FR-01.01–FR-01.03 NFR-02.01 BL-001–003 BL-010–BL-011")],
    ["FR-01.01", "FR-01.02", "FR-01.03", "NFR-02.01", "BL-001", "BL-002", "BL-003", "BL-010", "BL-011"]);
});
test("requires a nonempty purpose at the beginning, not a later heading", () => {
  for (const content of ["# Tytuł\n\nTreść\n\n**Cel:** za późno.", "# Tytuł\n\n**Cel:**\n\nTreść"]) {
    const docs = fixture();
    docs.set("docs/example.md", content);
    assert.ok(check(docs).some((error) => error.includes("Cel:")));
  }
});
test("rejects broken inline, image and reference links and paths escaping the repository", () => {
  for (const link of ["[x](missing.md)", "![x](missing.png)", "[x][ref]\n\n[ref]: missing.md", "[x](../../outside.md)"]) {
    const docs = fixture();
    docs.set("docs/example.md", purpose + link);
    assert.ok(check(docs).some((error) => error.includes("link")));
  }
});
test("validates paths containing parentheses and encoded spaces", () => {
  const docs = fixture();
  docs.set("docs/example.md", purpose + "[plik](<../some%20file.json>)\n[opis](folder/a(b).md)");
  assert.deepEqual(checkDocumentation(docs, new Set([...docs.keys(), "some file.json", "docs/folder/a(b).md"])), []);
});
test("accepts directory links with trailing slash and explicitly unmapped proposal tasks", () => {
  const docs = fixture();
  const backlog = "docs/08-plan/backlog.md";
  const matrix = "docs/00-przeglad/macierz-pokrycia.md";
  docs.set(backlog, docs.get(backlog) + "\n| BL-708 | Propozycja | — | DOC | — | 1 | todo |");
  docs.set(matrix, docs.get(matrix) + "\n| G-12 | Propozycja do rozstrzygnięcia | BL-708 |");
  docs.set("docs/example.md", purpose + "[katalog](00-przeglad/)");
  assert.deepEqual(checkDocumentation(docs, new Set([...docs.keys(), "docs/00-przeglad"])), []);
});
test("rejects malformed percent escaping without crashing", () => {
  const docs = fixture();
  docs.set("docs/example.md", purpose + "[x](broken%ZZ.md)");
  assert.ok(check(docs).some((error) => error.includes("link")));
});
test("rejects a requirement missing from the backlog or the matrix", () => {
  for (const path of ["docs/08-plan/backlog.md", "docs/00-przeglad/macierz-pokrycia.md"]) {
    const docs = fixture();
    docs.set(path, docs.get(path).replaceAll("NFR-01.01", "NFR-99.99"));
    const errors = check(docs).join("\n");
    assert.match(errors, /NFR-01\.01/);
    assert.match(errors, /NFR-99\.99/);
  }
});
test("rejects unknown matrix tasks and requires the correct task for each requirement", () => {
  const docs = fixture();
  const path = "docs/00-przeglad/macierz-pokrycia.md";
  docs.set(path, docs.get(path).replace("BL-001", "BL-999"));
  const errors = check(docs).join("\n");
  assert.match(errors, /BL-999/);
  assert.match(errors, /FR-01\.01.*BL-001/);
});
test("rejects unknown tasks in the matrix gap register as well", () => {
  const docs = fixture();
  const path = "docs/00-przeglad/macierz-pokrycia.md";
  docs.set(path, docs.get(path) + "\n| G-99 | Nieznana propozycja | BL-999 |");
  assert.ok(check(docs).some((error) => error.includes("BL-999")));
});
test("rejects backlog tasks absent from matrix rows even if mentioned in prose", () => {
  const docs = fixture();
  const backlog = "docs/08-plan/backlog.md";
  const matrix = "docs/00-przeglad/macierz-pokrycia.md";
  docs.set(backlog, docs.get(backlog) + "\n| BL-002 | Zadanie | FR-01.01 | DOC | — | 1 | todo |");
  docs.set(matrix, docs.get(matrix) + "\n\nWspomniane BL-002.");
  assert.ok(check(docs).some((error) => error.includes("FR-01.01") && error.includes("BL-002")));
});
test("rejects a task assigned to an unrelated requirement", () => {
  const docs = fixture();
  const backlog = "docs/08-plan/backlog.md";
  docs.set(backlog, docs.get(backlog) + "\n| BL-002 | Zadanie | FR-01.01 | DOC | — | 1 | todo |");
  const matrix = "docs/00-przeglad/macierz-pokrycia.md";
  docs.set(matrix, docs.get(matrix).replaceAll("| BL-001 |", "| BL-001, BL-002 |"));
  assert.ok(check(docs).some((error) => error.includes("NFR-01.01") && error.includes("BL-002")));
});
test("fails closed on missing sources, empty tables and duplicate definitions", () => {
  const docs = fixture();
  docs.delete("docs/08-plan/backlog.md");
  assert.ok(check(docs).length > 0);
  docs.set("docs/08-plan/backlog.md", purpose);
  assert.ok(check(docs).some((error) => error.includes("pusta")));
  const duplicates = fixture();
  const path = "docs/00-przeglad/wymagania.md";
  duplicates.set(path, duplicates.get(path) + "\n| FR-01.01 | Duplikat |");
  assert.ok(check(duplicates).some((error) => error.includes("Duplikat")));
});
