// Writes or checks the JSON Schema consumed by the Python worker (BL-311).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyticsContractDocument } from "../dist/analytics-jobs.js";

const target = fileURLToPath(
  new URL(
    "../../../apps/analytics/src/oliginvest_analytics/schemas/analytics-jobs.schema.json",
    import.meta.url,
  ),
);
const render = () => `${JSON.stringify(analyticsContractDocument(), null, 2)}\n`;

const mode = process.argv[2];
if (mode === "write") {
  writeFileSync(target, render());
  console.log("analytics-jobs.schema.json written");
} else if (mode === "check") {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    /* Missing file is reported below. */
  }
  if (current.replaceAll("\r\n", "\n") !== render()) {
    console.error("analytics-jobs.schema.json is stale; run pnpm gen:analytics-schema");
    process.exit(1);
  }
  console.log("analytics-jobs.schema.json is current");
} else {
  console.error("Usage: analytics-schema.mjs write|check");
  process.exit(2);
}
