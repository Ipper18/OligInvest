import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  need,
  open,
  privateKey,
  readExternal,
  registryFrom,
  requiredEnv,
  sameScope,
  seal,
  seconds,
  validVerdict,
} from "./evidence.mjs";
import { recordVerdict } from "./issuer-store.mjs";

// Only an authenticated issuer operator may invoke this process. Scope is supplied by the collector.
export function signVerdict(verdict, challenge, collectorKey, signer, key, now = seconds()) {
  const current = open(challenge, collectorKey);
  need(
    current.kind === "issuer-challenge" &&
      current.issuedAt <= now &&
      now < current.issuedAt + 60 &&
      sameScope(verdict, current) &&
      validVerdict(verdict, now),
    "invalid or stale verdict scope",
  );
  need(
    verdict.issuer === signer.id &&
      verdict.role === signer.role &&
      verdict.provider === signer.provider &&
      verdict.sequence === current.sequences[signer.role] + 1 &&
      signer.key.equals(createPublicKey(key)) &&
      !signer.key.equals(collectorKey) &&
      current.author !== signer.id &&
      (signer.role !== "reviewer" || signer.provider !== current.authorProvider),
    "issuer not authorized",
  );
  return seal(verdict, key);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(readExternal(requiredEnv("GATE_ISSUER_CONFIG")));
  const signer = registryFrom(config.registry)[config.role];
  const verdict = JSON.parse(readFileSync(0, "utf8"));
  const proof = JSON.parse(readExternal(config.challengeFile));
  const result = signVerdict(
    verdict,
    proof,
    createPublicKey(config.collectorPublicKey),
    { ...signer, role: config.role },
    privateKey("GATE_ISSUER_KEY"),
  );
  recordVerdict(config.issuerDirectory, result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
