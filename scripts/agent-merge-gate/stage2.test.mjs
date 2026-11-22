import assert from "node:assert/strict";
import test from "node:test";
import { acceptance } from "./acceptance.mjs";

test("offline acceptance covers positive and negative decisions", async () => {
  const report = await acceptance();
  assert.ok(report.cases.length >= 20);
  assert.deepEqual(
    report.cases.filter((item) => !item.pass),
    [],
  );
  assert.ok(report.cases.every((item) => item.mergeAllowed === false));
});
