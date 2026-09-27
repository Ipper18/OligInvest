import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import {
  assertContract,
  assertPending,
  generateDocument,
  pendingOperations,
  readBasePending,
} from "../scripts/openapi-contract.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const source = parse(readFileSync(join(root, "docs/02-api/openapi.yaml"), "utf8"));
const generated = await generateDocument();
const pending = JSON.parse(readFileSync(join(root, "apps/api/openapi-pending.json"), "utf8"));

test("Zod document matches all implemented operations and pending is the exact remainder", () => {
  assertContract(source, generated);
  assertPending(source, generated, pending, pending);
  expect(Object.keys(generated.paths)).toHaveLength(3);
});

test.each([
  [
    "undocumented operation",
    (doc) => {
      doc.paths["/extra"] = { get: { operationId: "extra" } };
    },
  ],
  [
    "wrong path",
    (doc) => {
      doc.paths["/moved"] = doc.paths["/health/live"];
      delete doc.paths["/health/live"];
    },
  ],
  [
    "wrong method",
    (doc) => {
      doc.paths["/health/live"].post = doc.paths["/health/live"].get;
      delete doc.paths["/health/live"].get;
    },
  ],
  [
    "wrong operationId",
    (doc) => {
      doc.paths["/health/live"].get.operationId = "changed";
    },
  ],
  [
    "missing operationId",
    (doc) => {
      delete doc.paths["/health/live"].get.operationId;
    },
  ],
  [
    "duplicate operationId",
    (doc) => {
      doc.paths["/health/ready"].get.operationId = "getHealthLive";
    },
  ],
  [
    "changed response shape",
    (doc) => {
      doc.components.schemas.HealthStatus.properties.status.type = "number";
    },
  ],
  [
    "extra response field",
    (doc) => {
      doc.components.schemas.HealthStatus.properties.extra = { type: "string" };
    },
  ],
  [
    "weakened strictness",
    (doc) => {
      delete doc.components.schemas.HealthStatus.additionalProperties;
    },
  ],
  [
    "missing status code",
    (doc) => {
      delete doc.paths["/health/ready"].get.responses[503];
    },
  ],
  [
    "extra status code",
    (doc) => {
      doc.paths["/health/live"].get.responses[429] = { description: "Limited" };
    },
  ],
  [
    "extra parameter",
    (doc) => {
      doc.paths["/health/live"].get.parameters = [
        { name: "q", in: "query", schema: { type: "string" } },
      ];
    },
  ],
  [
    "different media type",
    (doc) => {
      const response = doc.paths["/health/live"].get.responses[200];
      response.content["text/plain"] = response.content["application/json"];
      delete response.content["application/json"];
    },
  ],
  [
    "unresolved ref",
    (doc) => {
      doc.components.schemas.HealthStatus = { $ref: "#/components/schemas/Missing" };
    },
  ],
  [
    "external ref",
    (doc) => {
      doc.components.schemas.HealthStatus = { $ref: "https://example.invalid/schema" };
    },
  ],
  [
    "cyclic ref",
    (doc) => {
      doc.components.schemas.HealthStatus.properties.child = {
        $ref: "#/components/schemas/HealthStatus",
      };
    },
  ],
])("rejects %s", (_name, mutate) => {
  const changed = structuredClone(generated);
  mutate(changed);
  expect(() => assertContract(source, changed)).toThrow();
});

test("annotations, inline refs, enum ordering and open-object spellings are equivalent", () => {
  const changed = structuredClone(generated);
  const schema = changed.components.schemas.HealthStatus;
  schema.description = "Different wording";
  schema.properties.status.enum.reverse();
  changed.paths["/health/live"].get.responses[200].content["application/json"].schema = schema;
  changed.paths["/openapi.json"].get.responses[200].content["application/json"].schema = {
    type: "object",
    additionalProperties: {},
  };
  assertContract(source, changed);
});

test("property names that resemble annotations are still contractual", () => {
  const expected = structuredClone(generated);
  expected.components.schemas.HealthStatus.properties.description = { type: "string" };
  expect(() => assertContract(expected, generated)).toThrow();
});

test("path parameters are inherited, operation parameters override by name and location", () => {
  const expected = structuredClone(generated);
  const actual = structuredClone(generated);
  const parameter = {
    name: "q",
    in: "query",
    required: true,
    schema: { type: "string", minLength: 2 },
  };
  expected.paths["/health/live"].parameters = [parameter];
  actual.paths["/health/live"].parameters = [{ ...parameter, required: false }];
  actual.paths["/health/live"].get.parameters = [structuredClone(parameter)];
  assertContract(expected, actual);
  actual.paths["/health/live"].get.parameters[0].schema.minLength = 3;
  expect(() => assertContract(expected, actual)).toThrow();
});

test("pending rejects additions, replacements, duplicates, unknown and implemented IDs", () => {
  expect(() => assertPending(source, generated, pending, pending.slice(1))).toThrow(/grew/);
  expect(() =>
    assertPending(source, generated, pending, [...pending.slice(1), "replaced"]),
  ).toThrow(/grew/);
  for (const invalid of [
    [...pending, pending[0]],
    [...pending, "unknown"],
    [...pending, "getHealthLive"],
    pending.slice(1),
  ]) {
    expect(() => assertPending(source, generated, invalid, pending)).toThrow();
  }
});

test("an implemented operation cannot be moved back to pending", () => {
  const changed = structuredClone(generated);
  delete changed.paths["/health/live"];
  expect(() => assertPending(source, changed, pendingOperations(source, changed), pending)).toThrow(
    /grew/,
  );
});

test("pending can shrink when another operation is implemented", () => {
  const partial = structuredClone(generated);
  delete partial.paths["/health/live"];
  assertPending(source, generated, pending, pendingOperations(source, partial));
});

test("Git baseline reads the base branch, fails closed and bootstraps only a pre-skeleton base", () => {
  const cwd = mkdtempSync(join(tmpdir(), "oliginvest-contract-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const save = (path, text) => writeFileSync(join(cwd, path), text);
  const commit = () => {
    git("add", ".");
    git(
      "-c",
      "user.name=Contract test",
      "-c",
      "user.email=contract@example.invalid",
      "commit",
      "-qm",
      "fixture",
    );
  };
  try {
    git("init", "-q");
    mkdirSync(join(cwd, "docs/02-api"), { recursive: true });
    save("docs/02-api/openapi.yaml", stringify(source));
    commit();
    expect(readBasePending(cwd, "HEAD")).toEqual(pending);
    expect(() => readBasePending(cwd, "missing-ref")).toThrow();
    mkdirSync(join(cwd, "apps/api/src"), { recursive: true });
    save("apps/api/src/app.ts", "// fixture");
    commit();
    expect(() => readBasePending(cwd, "HEAD")).toThrow(/missing/);
    save("apps/api/openapi-pending.json", JSON.stringify(pending.slice(1)));
    commit();
    save("apps/api/openapi-pending.json", JSON.stringify(pending));
    expect(readBasePending(cwd, "HEAD")).toEqual(pending.slice(1));
    expect(() => assertPending(source, generated, pending, readBasePending(cwd, "HEAD"))).toThrow(
      /grew/,
    );
    save("apps/api/openapi-pending.json", "{}");
    commit();
    expect(() => readBasePending(cwd, "HEAD")).toThrow();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("Redocly exceptions apply only to the three approved operationIds", () => {
  const config = parse(readFileSync(join(root, "redocly.yaml"), "utf8"));
  expect(config.rules["operation-4xx-response"]).toBe("error");
  const ignored = parse(readFileSync(join(root, ".redocly.lint-ignore.yaml"), "utf8"));
  expect(Object.keys(ignored)).toEqual(["docs/02-api/openapi.yaml"]);
  expect(Object.keys(ignored["docs/02-api/openapi.yaml"])).toEqual(["operation-4xx-response"]);
  const ids = ignored["docs/02-api/openapi.yaml"]["operation-4xx-response"].map((pointer) => {
    const parts = pointer
      .slice(2)
      .split("/")
      .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
    assert.equal(parts.pop(), "responses");
    const operation = parts.reduce((value, part) => value[part], source);
    expect(operation.responses).not.toHaveProperty("429");
    return operation.operationId;
  });
  expect(ids.sort()).toEqual(["getHealthLive", "getHealthReady", "getOpenApiDocument"]);
});
