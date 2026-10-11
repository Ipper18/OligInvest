import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { anonymizeFile } from "../dist/src/import/anonymize.js";

try {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      output: { type: "string" },
      currency: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (!values.input || !values.output || !values.currency) throw new Error("MISSING_ARGUMENT");
  anonymizeFile(
    values.input,
    values.output,
    values.currency,
    fileURLToPath(new URL("../../../", import.meta.url)),
  );
  console.log(
    "Zapisano plik do lokalnego przeglądu. Przed publikacją sprawdź wszystkie komórki i właściwości zgodnie z ADR-013.",
  );
} catch {
  // Error text from parsers/fs can contain private values or paths; never log it.
  console.error(
    "Nie utworzono pliku. Sprawdź argumenty, walutę, obsługiwany format oraz nowe miejsce zapisu poza repozytorium. Instrukcja: modules/portfolio/scripts/README.md",
  );
  process.exitCode = 1;
}
