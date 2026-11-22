import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { assess, classify, requiredContexts } from "./gate.mjs";

const path = "docs/12-dla-uzytkownika/instrukcja.md";
const file = { path, status: "modified", beforeMode: "100644", afterMode: "100644" };
const roles = ["reviewer", "verifier"];
const keys = roles.map(() => generateKeyPairSync("ed25519"));
const registry = Object.fromEntries(
  roles.map((role, i) => [
    role,
    {
      id: role,
      provider: "provider-b",
      key: keys[i].publicKey,
    },
  ]),
);
const scope = {
  repo: "Ipper18/OligInvest",
  pr: 123,
  head: "a".repeat(40),
  base: "b".repeat(40),
  generation: "trial-1",
};
const collector = generateKeyPairSync("ed25519");
function seal(snapshot) {
  const payload = JSON.stringify(snapshot);
  return {
    payload,
    signature: sign(null, Buffer.from(payload), collector.privateKey).toString("base64"),
  };
}
function decide(snapshot, signers) {
  return assess(scope, seal(snapshot), collector.publicKey, signers);
}
test("untrusted edits and stale collection epochs cannot supply current facts", () => {
  const proof = seal(fixture());
  assert.equal(
    assess({ ...scope, generation: "trial-2" }, proof, collector.publicKey, registry).eligible,
    false,
  );
  assert.equal(
    assess(scope, { ...proof, payload: `${proof.payload} ` }, collector.publicKey, registry)
      .eligible,
    false,
  );
  assert.equal(assess(scope, proof, keys[0].publicKey, registry).eligible, false);
});
function envelope(role, overrides = {}, signer = roles.indexOf(role)) {
  const payload = JSON.stringify({
    ...scope,
    role,
    issuer: role,
    provider: "provider-b",
    verdict: "GOTOWE",
    risk: "LOW",
    ...overrides,
  });
  return {
    payload,
    signature: sign(null, Buffer.from(payload), keys[signer].privateKey).toString("base64"),
  };
}
function fixture() {
  return {
    ...scope,
    branch: "main",
    state: "OPEN",
    draft: false,
    mergeState: "CLEAN",
    author: "builder",
    authorProvider: "provider-a",
    rounds: 2,
    changedFiles: 1,
    files: [file],
    ci: requiredContexts.map((name) => ({ ...scope, name, conclusion: "success" })),
    codeql: { ...scope, complete: true, newAlerts: 0 },
    reviews: roles.map((role) => envelope(role)),
  };
}
test("only explicit ordinary documentation edits are low", () => {
  assert.equal(classify([file, { ...file, path: path.replace("instrukcja", "samouczki") }]), "LOW");
  for (const denied of [
    "docs/09-decyzje/ADR-019.md",
    "docs/06-bezpieczenstwo/mfa.md",
    "apps/api/src/auth/session.ts",
    "modules/admin/test.ts",
    "modules/identity/test.ts",
    "packages/db/migrations/0001.sql",
    "docs/03-dane/schema.sql",
    "docs/03-dane/testy-rls.sql",
    "infra/test.md",
    ".github/CODEOWNERS",
    ".github/workflows/test.yml",
    "docs/07-wdrozenie/ustawienia-repozytorium.md",
    ".env",
    "packages/config/test.ts",
    "package.json",
    "pnpm-lock.yaml",
    "scripts/ci-e2e.mjs",
    "scripts/agent-merge-gate/gate.mjs",
    "docs/12-dla-uzytkownika/../12-dla-uzytkownika/instrukcja.md",
  ]) {
    assert.equal(classify([file, { ...file, path: denied }]), "NIE-LOW", denied);
  }
  for (const change of [
    { afterMode: "120000" },
    { beforeMode: "120000" },
    { status: "renamed" },
    { previousPath: "infra/readme.md" },
    { afterMode: "100755" },
  ]) {
    assert.equal(classify([{ ...file, ...change }]), "NIE-LOW");
  }
  assert.equal(classify([]), "NIE-LOW");
  assert.equal(
    classify([file], { allow: [path], denyPrefixes: ["docs/"], denyNames: [] }),
    "NIE-LOW",
  );
});
test("a complete independent assessment qualifies only for dry run", () => {
  const result = decide(fixture(), registry);
  assert.deepEqual(result, { eligible: true, mergeAllowed: false, reason: "activation-off" });
});
const cases = {
  "old head": (s) => {
    s.head = "c".repeat(40);
  },
  "main advanced": (s) => {
    s.base = "c".repeat(40);
  },
  "update branch": (s) => {
    s.generation = "trial-2";
  },
  "reviewer missing": (s) => s.reviews.shift(),
  "verifier missing": (s) => s.reviews.pop(),
  "same provider": (s) => {
    s.authorProvider = "provider-b";
  },
  "red CI": (s) => {
    s.ci[0].conclusion = "failure";
  },
  "missing CI": (s) => s.ci.pop(),
  "duplicate CI": (s) => {
    s.ci[1] = s.ci[0];
  },
  "new alert": (s) => {
    s.codeql.newAlerts = 1;
  },
  "analysis incomplete": (s) => {
    s.codeql.complete = false;
  },
  "extra round": (s) => {
    s.rounds = 3;
  },
  "critical mixed diff": (s) => {
    s.files.push({ ...file, path: ".github/CODEOWNERS" });
    s.changedFiles++;
  },
  "truncated diff": (s) => {
    s.changedFiles++;
  },
  "author issued review": (s) => {
    s.author = "reviewer";
  },
  "wrong signer": (s) => {
    s.reviews[0] = envelope("reviewer", {}, 1);
  },
  "old signed review": (s) => {
    s.reviews[0] = envelope("reviewer", { head: "c".repeat(40) });
  },
  "different PR": (s) => {
    s.reviews[0] = envelope("reviewer", { pr: 124 });
  },
  "changes requested": (s) => {
    s.reviews[0] = envelope("reviewer", { verdict: "DO POPRAWY" });
  },
  conflict: (s) => {
    s.mergeState = "DIRTY";
  },
  behind: (s) => {
    s.mergeState = "BEHIND";
  },
  draft: (s) => {
    s.draft = true;
  },
  "comments cannot substitute for signatures": (s) => {
    s.comments = s.reviews;
    s.reviews = [];
    s.body = "GOTOWE";
    s.mergeAllowed = true;
  },
};
for (const [name, mutate] of Object.entries(cases)) {
  test(name, () => {
    const snapshot = fixture();
    mutate(snapshot);
    const result = decide(snapshot, registry);
    assert.equal(result.eligible, false);
    assert.equal(result.mergeAllowed, false);
    assert.ok(result.reason);
  });
}
test("a shared signing key cannot represent independent roles", () => {
  const s = fixture();
  s.reviews[1] = envelope("verifier", {}, 0);
  assert.equal(
    decide(s, { ...registry, verifier: { ...registry.verifier, key: registry.reviewer.key } })
      .eligible,
    false,
  );
});
