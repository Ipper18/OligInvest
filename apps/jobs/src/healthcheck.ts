import { checkHealth } from "./runtime.js";

try {
  process.exitCode = (await checkHealth(process.env)) ? 0 : 1;
} catch {
  process.exitCode = 1;
}
