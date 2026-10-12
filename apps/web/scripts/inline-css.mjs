import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";

const input = new URL("../src/app/globals.css", import.meta.url);
const result = await postcss([tailwind({ optimize: true })]).process(readFileSync(input, "utf8"), {
  from: fileURLToPath(input),
});
if (!result.css || /<\/style/i.test(result.css)) throw new Error("Invalid trusted CSS output");
writeFileSync(
  new URL("../src/appearance/inline-css.json", import.meta.url),
  JSON.stringify({ css: result.css }, null, 2) + "\n",
);
