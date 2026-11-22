import { execFileSync } from "node:child_process";
import { createPublicKey } from "node:crypto";
import { join } from "node:path";
import { collector } from "./collector.mjs";
import {
  need,
  open,
  positive,
  readExternal,
  registryFrom,
  requiredEnv,
  roles,
} from "./evidence.mjs";
import { latestVerdict } from "./issuer-store.mjs";

// The config and the authenticated issuer/journal projections are owned by the operator.
const [operation, number] = process.argv.slice(2);
const pr = Number(number);
need(
  positive(pr) && ["challenge", "evaluate"].includes(operation),
  "usage: collect-cli.mjs challenge|evaluate PR",
);
const config = JSON.parse(readExternal(requiredEnv("GATE_COLLECTOR_CONFIG")));
const readJson = (path) => JSON.parse(readExternal(path));
const adapter = collector({
  installedMain: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: new URL("../../", import.meta.url),
    encoding: "utf8",
  }).trim(),
  pins: config.pins,
  registry: registryFrom(config.registry),
  readJournal: (n) => readJson(join(config.journalDirectory, `${String(n)}.json`)),
  readLatest: (role, n) => {
    need(roles.includes(role), "invalid role");
    return latestVerdict(config.issuerDirectories[role], n);
  },
});
const result = await adapter[operation](pr);
open(operation === "challenge" ? result : result.proof, createPublicKey(config.collectorPublicKey));
process.stdout.write(`${JSON.stringify(result)}\n`);
if (operation === "evaluate" && !result.decision.eligible) process.exitCode = 1;
