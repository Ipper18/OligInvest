import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { createApp } from "../dist/app.js";

const METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
const BOOTSTRAP_IMPLEMENTED = new Set(["getHealthLive", "getHealthReady", "getOpenApiDocument"]);
const PENDING_PATH = "apps/api/openapi-pending.json";
const ANNOTATIONS = new Set([
  "title",
  "description",
  "example",
  "examples",
  "$comment",
  "externalDocs",
]);
const SCHEMA_MAPS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);
const SCHEMA_VALUES = new Set([
  "items",
  "contains",
  "additionalProperties",
  "unevaluatedProperties",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "additionalItems",
  "unevaluatedItems",
]);
const SCHEMA_LISTS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);

// Resolve only local JSON pointers. Never fetch data while checking a contract.
function resolve(value, document, stack = []) {
  if (Array.isArray(value)) return value.map((item) => resolve(item, document, stack));
  if (value === null || typeof value !== "object") return value;
  if (Object.hasOwn(value, "$ref")) {
    const { $ref, ...siblings } = value;
    assert.equal(typeof $ref, "string", "Invalid $ref");
    assert.ok($ref.startsWith("#/"), `External $ref is unsupported: ${$ref}`);
    assert.ok(!stack.includes($ref), `Cyclic $ref is unsupported: ${$ref}`);
    const target = $ref
      .slice(2)
      .split("/")
      .reduce((node, part) => {
        const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
        assert.ok(node && Object.hasOwn(node, key), `Unresolved $ref: ${$ref}`);
        return node[key];
      }, document);
    const resolved = resolve(target, document, [...stack, $ref]);
    const rest = resolve(siblings, document, stack);
    if (Object.keys(rest).length === 0) return resolved;
    // Do not overwrite constraints from the referenced schema with sibling values.
    for (const key of Object.keys(rest)) {
      if (Object.hasOwn(resolved, key) && !ANNOTATIONS.has(key)) {
        assert.deepEqual(rest[key], resolved[key], `Conflicting $ref sibling: ${key}`);
      }
    }
    return { ...resolved, ...rest };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, resolve(item, document, stack)]),
  );
}

function schema(value) {
  if (value === true) return {};
  if (value === false) return false;
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "Invalid schema");
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (ANNOTATIONS.has(key) || key.startsWith("x-")) continue;
    if (SCHEMA_MAPS.has(key)) {
      result[key] = Object.fromEntries(
        Object.entries(item).map(([name, child]) => [name, schema(child)]),
      );
    } else if (SCHEMA_VALUES.has(key)) {
      const normalized = schema(item);
      if (
        key !== "additionalProperties" ||
        normalized === false ||
        Object.keys(normalized).length
      ) {
        result[key] = normalized;
      }
    } else if (SCHEMA_LISTS.has(key)) {
      result[key] = item.map(schema);
    } else if (key === "required" || key === "enum" || (key === "type" && Array.isArray(item))) {
      result[key] = [...item].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    } else {
      result[key] = item;
    }
  }
  return result;
}

function content(value = {}) {
  return Object.fromEntries(
    Object.entries(value).map(([type, media]) => [
      type,
      {
        ...(Object.hasOwn(media, "schema") ? { schema: schema(media.schema) } : {}),
        ...(media.encoding ? { encoding: media.encoding } : {}),
      },
    ]),
  );
}

function parameter(value) {
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (ANNOTATIONS.has(key) || key.startsWith("x-")) continue;
    result[key] = key === "schema" ? schema(item) : key === "content" ? content(item) : item;
  }
  result.required ??= false;
  return result;
}

export function operations(document) {
  assert.ok(document.paths && typeof document.paths === "object", "Missing paths");
  const result = new Map();
  for (const [path, rawPathItem] of Object.entries(document.paths)) {
    // Resolve only implemented operations later, not the entire 290 KB contract.
    const pathItem = rawPathItem.$ref ? resolve(rawPathItem, document) : rawPathItem;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!METHODS.has(method)) continue;
      const id = operation.operationId;
      assert.ok(typeof id === "string" && id.length > 0, `Missing operationId: ${method} ${path}`);
      assert.ok(!result.has(id), `Duplicate operationId: ${id}`);
      result.set(id, { path, method, operation, pathItem });
    }
  }
  return result;
}

function contract(entry, document) {
  const operation = resolve(entry.operation, document);
  const inherited = resolve(entry.pathItem.parameters ?? [], document);
  const parameters = new Map();
  for (const layer of [inherited, operation.parameters ?? []]) {
    const seen = new Set();
    for (const item of layer) {
      const key = `${item.in}:${item.name}`;
      assert.ok(!seen.has(key), `Duplicate parameter: ${key}`);
      seen.add(key);
      parameters.set(key, parameter(item));
    }
  }
  assert.ok(operation.responses && Object.keys(operation.responses).length, "Missing responses");
  return {
    path: entry.path,
    method: entry.method,
    operationId: operation.operationId,
    parameters: [...parameters.entries()].sort(([a], [b]) => a.localeCompare(b)),
    responses: Object.fromEntries(
      Object.entries(operation.responses).map(([code, response]) => [
        code,
        {
          content: content(response.content),
          headers: Object.fromEntries(
            Object.entries(response.headers ?? {}).map(([name, header]) => [
              name.toLowerCase(),
              parameter(header),
            ]),
          ),
        },
      ]),
    ),
    ...(operation.requestBody
      ? {
          requestBody: {
            required: operation.requestBody.required ?? false,
            content: content(operation.requestBody.content),
          },
        }
      : {}),
    security: operation.security ?? document.security ?? [],
  };
}

export function assertContract(source, generated) {
  assert.equal(generated.openapi, source.openapi, "OpenAPI version mismatch");
  const expected = operations(source);
  const actual = operations(generated);
  assert.ok(actual.size > 0, "Generated document has no operations");
  for (const [id, entry] of actual) {
    assert.ok(expected.has(id), `Undocumented operation: ${id}`);
    assert.deepEqual(
      contract(entry, generated),
      contract(expected.get(id), source),
      `Contract mismatch: ${id}`,
    );
  }
}

export function pendingOperations(source, generated) {
  assertContract(source, generated);
  const implemented = operations(generated);
  return [...operations(source).keys()].filter((id) => !implemented.has(id)).sort();
}

function pendingList(value) {
  assert.ok(
    Array.isArray(value) && value.every((id) => typeof id === "string" && id.length),
    "Invalid pending list",
  );
  assert.equal(new Set(value).size, value.length, "Duplicate pending operationId");
  return value;
}

export function assertPending(source, generated, pending, basePending) {
  pendingList(pending);
  const base = new Set(pendingList(basePending));
  const added = pending.filter((id) => !base.has(id));
  assert.equal(added.length, 0, `Pending grew relative to base: ${added.join(", ")}`);
  assert.deepEqual(
    pending,
    pendingOperations(source, generated),
    "Pending must be the sorted exact remainder of the contract",
  );
}

export function readBasePending(root, ref) {
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const sha = git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`).trim();
  const paths = git("ls-tree", "-r", "--name-only", sha, "--", PENDING_PATH, "apps/api/src/app.ts")
    .trim()
    .split("\n");
  if (paths.includes(PENDING_PATH))
    return pendingList(JSON.parse(git("show", `${sha}:${PENDING_PATH}`)));
  assert.ok(
    !paths.includes("apps/api/src/app.ts"),
    "Base pending file missing after API bootstrap",
  );
  const baseSource = parse(git("show", `${sha}:docs/02-api/openapi.yaml`));
  return [...operations(baseSource).keys()].filter((id) => !BOOTSTRAP_IMPLEMENTED.has(id)).sort();
}

export async function generateDocument() {
  const unexpectedProbe = async () => {
    throw new Error("OpenAPI must not probe infrastructure");
  };
  const app = createApp({
    checks: {
      postgres: unexpectedProbe,
      valkeyQueue: unexpectedProbe,
      valkeyCache: unexpectedProbe,
    },
    logger: { info() {}, warn() {}, error() {} },
    publicBaseUrl: "https://contract.example.invalid",
  });
  const response = await app.request("/api/v1/openapi.json");
  assert.equal(response.status, 200, "OpenAPI endpoint failed");
  return response.json();
}

export function readSource(root) {
  return parse(readFileSync(join(root, "docs/02-api/openapi.yaml"), "utf8"));
}
