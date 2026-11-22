import { verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonical, digest, seconds, validVerdict } from "./evidence.mjs";
import { distinctJobs, proven } from "./provenance.mjs";

function loadJson(path) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
}
const policy = loadJson("./policy.json");
const rules = loadJson("../../.github/rulesets/main.json").rules;
export const requiredContexts = Object.freeze(
  rules
    .find((rule) => rule.type === "required_status_checks")
    .parameters.required_status_checks.map((check) => check.context),
);

function ordinaryEdit(file, config) {
  if (
    file?.status !== "modified" ||
    file.beforeMode !== "100644" ||
    file.afterMode !== "100644" ||
    Object.hasOwn(file, "previousPath") ||
    typeof file.path !== "string"
  )
    return false;
  const path = file.path.toLowerCase();
  const name = path.split("/").at(-1);
  return (
    !config.denyPrefixes.some((prefix) => path.startsWith(prefix)) &&
    !config.denyNames.includes(name) &&
    config.allow.includes(file.path)
  );
}
export function classify(files, config = policy) {
  return Array.isArray(files) &&
    files.length > 0 &&
    Array.from(files).every((file) => ordinaryEdit(file, config)) &&
    new Set(files.map((file) => file.path)).size === files.length
    ? "LOW"
    : "NIE-LOW";
}

function matchesScope(record, current) {
  return (
    record &&
    ["repo", "pr", "head", "base", "generation"].every((key) => record[key] === current[key])
  );
}
function identity(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
}
function validReviews(snapshot, registry, current) {
  if (!Array.isArray(snapshot.reviews) || snapshot.reviews.length !== 2) return false;
  const seen = new Set();
  const keys = new Set();
  const ids = new Set([snapshot.author]);
  for (const envelope of snapshot.reviews) {
    if (
      typeof envelope?.payload !== "string" ||
      envelope.payload.length > 4096 ||
      typeof envelope.signature !== "string" ||
      !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)
    )
      return false;
    const review = JSON.parse(envelope.payload);
    if (
      !validVerdict(review, seconds()) ||
      canonical(review) !== envelope.payload ||
      review.sequence !== current.sequences[review.role] ||
      digest(envelope) !== current.latest[review.role]
    )
      return false;
    if (!["reviewer", "verifier"].includes(review?.role) || seen.has(review.role)) return false;
    const signer = registry[review.role];
    if (
      !signer ||
      !identity(signer.id) ||
      !identity(signer.provider) ||
      signer.key?.type !== "public" ||
      signer.key.asymmetricKeyType !== "ed25519"
    )
      return false;
    const fingerprint = signer.key.export({ type: "spki", format: "der" }).toString("base64");
    if (
      keys.has(fingerprint) ||
      ids.has(signer.id) ||
      !matchesScope(review, snapshot) ||
      review.issuer !== signer.id ||
      review.provider !== signer.provider ||
      review.verdict !== "GOTOWE" ||
      review.risk !== "LOW" ||
      (review.role === "reviewer" && signer.provider === snapshot.authorProvider) ||
      !verify(
        null,
        Buffer.from(envelope.payload),
        signer.key,
        Buffer.from(envelope.signature, "base64"),
      )
    )
      return false;
    seen.add(review.role);
    ids.add(signer.id);
    keys.add(fingerprint);
  }
  return true;
}
const deny = (reason) => ({ eligible: false, mergeAllowed: false, reason });

// Only the isolated adapter supplies the current snapshot and pinned role registry.
function decide(snapshot, registry, current) {
  if (
    snapshot?.repo !== "Ipper18/OligInvest" ||
    snapshot.branch !== "main" ||
    !Number.isSafeInteger(snapshot.pr) ||
    snapshot.pr < 1 ||
    ![snapshot.head, snapshot.base].every(
      (sha) => typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha),
    ) ||
    !identity(snapshot.generation) ||
    !identity(snapshot.author) ||
    !identity(snapshot.authorProvider)
  )
    return deny("invalid-scope");
  if (snapshot.state !== "OPEN" || snapshot.draft !== false || snapshot.mergeState !== "CLEAN")
    return deny("pr-not-ready");
  if (classify(snapshot.files) !== "LOW" || snapshot.changedFiles !== snapshot.files.length)
    return deny("risk-or-incomplete-diff");
  if (!Number.isInteger(snapshot.rounds) || snapshot.rounds < 0 || snapshot.rounds > 2)
    return deny("review-rounds");
  if (
    requiredContexts.length !== 20 ||
    new Set(requiredContexts).size !== 20 ||
    !Array.isArray(snapshot.ci) ||
    snapshot.ci.length !== requiredContexts.length ||
    !requiredContexts.every((name) =>
      snapshot.ci.some(
        (check) =>
          check?.name === name &&
          check.conclusion === "success" &&
          matchesScope(check, snapshot) &&
          proven(check, current.pins),
      ),
    )
  )
    return deny("required-ci");
  if (
    !matchesScope(snapshot.codeql, snapshot) ||
    snapshot.codeql.complete !== true ||
    snapshot.codeql.newAlerts !== 0
  )
    return deny("codeql");
  try {
    distinctJobs(snapshot.ci);
    if (!validReviews(snapshot, registry, current)) return deny("independent-reviews");
  } catch {
    return deny("invalid-review-envelope");
  }
  return { eligible: true, mergeAllowed: false, reason: "activation-off" };
}

// current comes from a fresh, independent read. Only the collector attests GitHub facts.
export function assess(current, proof, collectorKey, registry) {
  try {
    if (
      collectorKey?.type !== "public" ||
      collectorKey.asymmetricKeyType !== "ed25519" ||
      typeof proof?.payload !== "string" ||
      proof.payload.length > 131072 ||
      typeof proof.signature !== "string" ||
      !/^[A-Za-z0-9+/]{86}==$/.test(proof.signature) ||
      !verify(
        null,
        Buffer.from(proof.payload),
        collectorKey,
        Buffer.from(proof.signature, "base64"),
      )
    ) {
      return deny("collector-signature");
    }
    if (["reviewer", "verifier"].some((role) => collectorKey.equals(registry[role].key)))
      return deny("shared-collector-key");
    const snapshot = JSON.parse(proof.payload);
    if (!matchesScope(snapshot, current)) return deny("stale-snapshot");
    if (
      current.mergeState !== "CLEAN" ||
      current.mergeState !== snapshot.mergeState ||
      current.state !== "OPEN" ||
      current.draft !== false
    )
      return deny("changed-pr-state");
    return decide(snapshot, registry, current);
  } catch {
    return deny("invalid-evidence");
  }
}
