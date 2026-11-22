import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collector } from "./collector.mjs";
import { open, seconds } from "./evidence.mjs";
import { planMerge, shutdownPlan } from "./executor.mjs";
import { githubReader, pages } from "./github.mjs";
import { latestVerdict, recordVerdict } from "./issuer-store.mjs";
import { replay } from "./journal.mjs";
import { publishResult } from "./publish-result.mjs";
import { recordOperation } from "./record-operation.mjs";
import { signVerdict } from "./sign-verdict.mjs";
import { trial } from "./trial-fixture.mjs";

test("collector refuses issuer private keys or reused collector credentials", async () => {
  const f = await trial();
  for (const key of [f.keys.reviewer.privateKey, f.keys.collector.publicKey]) {
    assert.throws(
      () =>
        collector({
          ...f.options,
          registry: { ...f.registry, reviewer: { ...f.registry.reviewer, key } },
        }),
      /separation/,
    );
  }
  assert.deepEqual(Object.keys(f.adapter).sort(), ["challenge", "current", "evaluate", "reassess"]);
});
test("issuer binds role, scope, canonical bytes, lease and next sequence", async () => {
  const f = await trial();
  const challenge = await f.adapter.challenge(f.pr);
  const current = open(challenge, f.keys.collector.publicKey);
  const v = { ...JSON.parse(f.latest.reviewer.payload), sequence: 2 };
  const issue = (value, now) =>
    signVerdict(
      value,
      challenge,
      f.keys.collector.publicKey,
      f.registry.reviewer,
      f.keys.reviewer.privateKey,
      now,
    );
  assert.deepEqual(open(issue(v), f.keys.reviewer.publicKey), v);
  for (const mutation of [
    { extra: 1 },
    { ttl: 901 },
    { ttl: 0 },
    { issuedAt: seconds() + 30 },
    { pr: 0 },
    { role: "verifier" },
    { generation: "stale" },
    { sequence: 1 },
    { risk: "unknown" },
    { head: "0".repeat(40) },
  ])
    assert.throws(() => issue({ ...v, ...mutation }));
  assert.throws(() => issue(v, current.issuedAt + 60));
});
test("issuer store consumes one slot per sequence, latest negative wins", async (t) => {
  const f = await trial();
  const folder = mkdtempSync(join(tmpdir(), "gate-issuer-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const previous = f.latest.reviewer;
  recordVerdict(folder, previous);
  assert.throws(() => recordVerdict(folder, previous), { code: "EEXIST" });
  const revoked = await f.issue("reviewer", { verdict: "DO POPRAWY" });
  recordVerdict(folder, revoked);
  assert.deepEqual(latestVerdict(folder, f.pr), revoked);
});
test("journal gaps require a fresh generation preserving round and sequence watermarks", async () => {
  const f = await trial();
  const previous = replay(f.events, f.pr);
  const gap = { pr: f.pr, type: "round", offset: 7 };
  assert.throws(() => replay([...f.events, gap], f.pr), /gap/);
  const recovered = { ...f.events[0], offset: 8, sequences: previous.sequences, rounds: 2 };
  const state = replay([...f.events, recovered], f.pr);
  assert.notEqual(previous.generation, state.generation);
  assert.deepEqual(state.latest, {});
  assert.throws(() =>
    replay([...f.events, { ...recovered, sequences: { reviewer: 0, verifier: 0 } }], f.pr),
  );
});
test("a later verdict seen at the issuer blocks an earlier published approval even before its journal receipt", async () => {
  const f = await trial();
  const result = await f.adapter.evaluate(f.pr);
  await f.issue("reviewer", { verdict: "DO POPRAWY" });
  f.events.pop();
  await assert.rejects(f.adapter.reassess(result), /issuer and journal disagree/);
});
test("new CI attempt before journal receipt and wrong synthetic parents fail closed", async () => {
  const f = await trial();
  f.runs[0].run_attempt++;
  await assert.rejects(f.adapter.evaluate(f.pr), /acknowledged/);
  f.runs[0].run_attempt--;
  f.responses.get(`/git/commits/${f.merge}`).parents.reverse();
  await assert.rejects(f.adapter.evaluate(f.pr), /parents/);
});
test("journal atomically checks the delivery cursor and authenticates the verdict before appending", async (t) => {
  const f = await trial();
  const folder = mkdtempSync(join(tmpdir(), "gate-journal-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  assert.equal(recordOperation(folder, f.events[0], f.registry, 0).offset, 1);
  assert.throws(() => recordOperation(folder, f.events[1], f.registry, 0), /cursor/);
  const invalid = {
    ...f.events[1],
    envelope: { ...f.events[1].envelope, signature: f.latest.verifier.signature },
  };
  assert.throws(() => recordOperation(folder, invalid, f.registry, 1), /signature/);
  assert.equal(recordOperation(folder, f.events[1], f.registry, 1).offset, 2);
});
test("collector reads later pages and refuses truncation and rate limits", async () => {
  const path = "/list";
  const batch = Array.from({ length: 100 }, (_, n) => n);
  assert.equal(
    (await pages(async (p) => (p.endsWith("page=1") ? batch : [100]), path)).length,
    101,
  );
  await assert.rejects(
    pages(async () => ({ items: [], total_count: 2 }), path, "items"),
    /incomplete/,
  );
  await assert.rejects(
    githubReader("synthetic", async () => ({ ok: false, status: 403 }))("/pulls/1"),
    /403/,
  );
});
test("dry-run executor binds both revisions; shutdown plan has no side effects", async () => {
  const f = await trial();
  const result = await f.adapter.evaluate(f.pr);
  const fresh = await f.adapter.current(f.pr);
  const plan = planMerge(result, fresh, true);
  assert.deepEqual(plan.argv, [
    "gh",
    "pr",
    "merge",
    "17",
    "--repo",
    "Ipper18/OligInvest",
    "--auto",
    "--squash",
    "--match-head-commit",
    f.head,
  ]);
  assert.equal(plan.mergeAllowed, false);
  for (const key of ["head", "base", "generation"])
    assert.equal(planMerge(result, { ...fresh, [key]: "changed" }, true).argv, null);
  assert.equal(
    planMerge({ ...result, decision: { eligible: false, mergeAllowed: false } }, fresh, true).argv,
    null,
  );
  assert.deepEqual(
    shutdownPlan([17], [19]).steps.map((s) => s.operation),
    [
      "stop-executor",
      "cancel-auto-merge",
      "invalidate-check",
      "rotate-generation-and-verify-inventory",
    ],
  );
});
test("publisher defaults off, verifies installation identity and posts only a trial check", async () => {
  const f = await trial();
  const calls = [];
  const http = async (url, options) => {
    const index = calls.length;
    calls.push({ url, options });
    const values = [
      { id: 9 },
      { id: 4, app_id: 9 },
      { permissions: { checks: "write" }, token: "synthetic" },
      { id: 88, app: { id: 9 }, head_sha: f.head },
    ];
    return { ok: true, json: async () => values[index] };
  };
  const args = { ...f.adapter, pr: f.pr, appId: 9, installationId: 4, appJwt: "synthetic", http };
  assert.deepEqual(await publishResult(args), { published: false });
  assert.equal(calls.length, 0);
  const receipt = await publishResult({ ...args, enabled: true });
  assert.equal(receipt.mergeAllowed, false);
  const body = JSON.parse(calls.at(-1).options.body);
  assert.equal(body.name, "agent-merge-gate/trial");
  assert.equal(body.head_sha, f.head);
  calls.length = 0;
  await assert.rejects(publishResult({ ...args, appId: 10, enabled: true }), /wrong publisher/);
  assert.ok(calls.every((c) => c.options.method === "GET"));
});
