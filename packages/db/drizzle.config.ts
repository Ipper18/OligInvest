import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/schema.ts", "../../modules/*/db/schema.ts"],
  out: "./migrations",
  strict: true,
  verbose: true,
});
