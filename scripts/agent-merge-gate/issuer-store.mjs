import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { need, outside, positive, readExternal } from "./evidence.mjs";

// One owner-controlled store per issuer. An interrupted write consumes its slot and fails closed.
export function latestVerdict(directory, pr) {
  need(positive(pr), "invalid PR");
  const folder = outside(join(directory, String(pr)));
  const files = readdirSync(folder);
  need(
    files.length && files.every((name) => /^[1-9][0-9]*\.json$/.test(name)),
    "unknown issuer records",
  );
  const sequences = files.map((name) => Number.parseInt(name, 10));
  need(sequences.every(positive), "invalid stored sequence");
  const sequence = sequences.reduce((a, b) => Math.max(a, b));
  const envelope = JSON.parse(readExternal(join(folder, `${sequence}.json`)));
  const v = JSON.parse(envelope.payload);
  need(v.pr === pr && v.sequence === sequence, "issuer sequence mismatch");
  return envelope;
}
export function recordVerdict(directory, envelope) {
  const { pr, sequence } = JSON.parse(envelope.payload);
  need(positive(pr) && positive(sequence), "invalid verdict coordinates");
  const parent = outside(directory);
  const folder = join(parent, String(pr));
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  outside(folder);
  const fd = openSync(join(folder, `${sequence}.json`), "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(envelope)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
