import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repo = "Ipper18/OligInvest";
export const roles = ["reviewer", "verifier"];
export const seconds = () => Math.floor(Date.now() / 1000);
export const positive = (n) => Number.isSafeInteger(n) && n > 0;
export function need(condition, message) {
  if (!condition) throw new Error(message);
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  need(
    value !== undefined && (typeof value !== "number" || Number.isFinite(value)),
    "invalid JSON",
  );
  return JSON.stringify(value);
}
export function digest(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export const scopeKeys = ["repo", "pr", "head", "base", "generation"];
export function sameScope(a, b) {
  return scopeKeys.every((k) => a[k] === b[k]);
}
export function seal(value, key) {
  need(key.type === "private" && key.asymmetricKeyType === "ed25519", "invalid signing key");
  const payload = canonical(value);
  return { payload, signature: sign(null, Buffer.from(payload), key).toString("base64") };
}
export function open(envelope, key) {
  need(
    key.type === "public" &&
      key.asymmetricKeyType === "ed25519" &&
      typeof envelope.payload === "string" &&
      envelope.payload.length <= 131072 &&
      /^[A-Za-z0-9+/]{86}==$/.test(envelope.signature) &&
      verify(null, Buffer.from(envelope.payload), key, Buffer.from(envelope.signature, "base64")),
    "invalid signature",
  );
  const value = JSON.parse(envelope.payload);
  need(canonical(value) === envelope.payload, "noncanonical evidence");
  return value;
}
export function outside(path) {
  need(isAbsolute(path), "absolute external path required");
  const real = realpathSync(path);
  const local = relative(realpathSync(fileURLToPath(new URL("../../", import.meta.url))), real);
  need(isAbsolute(local) || local.startsWith(`..${sep}`), "file must be outside the repository");
  return real;
}
export function readExternal(path) {
  return readFileSync(outside(path), "utf8");
}
export function requiredEnv(name) {
  const value = process.env[name];
  need(typeof value === "string" && value.length > 0, `missing ${name}`);
  return value;
}
export function privateKey(name, env = process.env) {
  const pem = env[name];
  const file = env[`${name}_FILE`];
  need(Boolean(pem) !== Boolean(file), "choose one external key source");
  return createPrivateKey(pem || readExternal(file));
}
export function registryFrom(entries) {
  return Object.fromEntries(
    roles.map((role) => {
      const { id, provider, publicKey } = entries[role];
      need(
        typeof publicKey === "string" && publicKey.startsWith("-----BEGIN PUBLIC KEY-----"),
        "public registry required",
      );
      return [role, { id, provider, key: createPublicKey(publicKey) }];
    }),
  );
}
export function validVerdict(v, now) {
  const fields = [
    ...scopeKeys,
    "role",
    "provider",
    "issuer",
    "verdict",
    "risk",
    "issuedAt",
    "ttl",
    "sequence",
  ].sort();
  return (
    Object.keys(v).sort().join("|") === fields.join("|") &&
    v.repo === repo &&
    positive(v.pr) &&
    [v.base, v.head].every((x) => typeof x === "string" && /^[0-9a-f]{40}$/.test(x)) &&
    [v.generation, v.issuer, v.provider].every(
      (x) => typeof x === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(x),
    ) &&
    roles.includes(v.role) &&
    ["GOTOWE", "DO POPRAWY", "STOP"].includes(v.verdict) &&
    ["LOW", "NIE-LOW"].includes(v.risk) &&
    positive(v.sequence) &&
    positive(v.issuedAt) &&
    positive(v.ttl) &&
    v.ttl <= 900 &&
    v.issuedAt <= now &&
    now < v.issuedAt + v.ttl
  );
}
