import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { pwaMessages as t } from "@oliginvest/i18n";
import { build } from "esbuild";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const directory = new URL("../public/", import.meta.url);
mkdirSync(new URL("icons/", directory), { recursive: true });
const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/pwa/worker.js", import.meta.url))],
  bundle: true,
  minify: true,
  write: false,
  platform: "browser",
  format: "iife",
  target: "es2022",
});
writeFileSync(
  new URL("sw.js", directory),
  result.outputFiles[0].text.replaceAll("__PWA_VERSION__", randomUUID()),
);
// Original geometric O mark: PNG encoder using Node's built-in zlib, no runtime dependency.
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const label = Buffer.from(type),
    size = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc(Buffer.concat([label, data])));
  return Buffer.concat([size, label, data, checksum]);
}
for (const [name, size] of [
  ["180", 180],
  ["192", 192],
  ["512", 512],
  ["maskable", 512],
]) {
  const data = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - size / 2, y - size / 2) / size,
        mark = distance > 0.18 && distance < 0.3,
        offset = y * (size * 3 + 1) + 1 + x * 3;
      data.set(mark ? [168, 223, 192] : [11, 13, 15], offset);
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  writeFileSync(
    new URL(`icons/icon-${name}.png`, directory),
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(data)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const html =
  "<!doctype html>" +
  renderToStaticMarkup(
    h(
      "html",
      { lang: "pl" },
      h(
        "head",
        null,
        h("meta", { charSet: "utf-8" }),
        h("meta", { name: "viewport", content: "width=device-width,initial-scale=1" }),
        h("title", null, t.offlineTitle),
        h("link", { rel: "stylesheet", href: "/offline.css" }),
      ),
      h(
        "body",
        null,
        h(
          "main",
          null,
          h("h1", null, t.offlineTitle),
          h("p", null, t.offlineBody),
          h("a", { href: "/" }, t.reconnect),
        ),
      ),
    ),
  );
writeFileSync(
  new URL("../src/pwa/offline-page.json", import.meta.url),
  JSON.stringify({ html }) + "\n",
);
writeFileSync(
  new URL("offline.css", directory),
  "body{font:1rem system-ui;background:#0B0D0F;color:#FAFAF7;margin:0;padding:2rem}main{max-width:38rem;margin:15vh auto}a{color:#a8dfc0}",
);
