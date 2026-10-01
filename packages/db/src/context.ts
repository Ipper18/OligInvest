import { z } from "zod";

const databaseContextSchema = z.discriminatedUnion("role", [
  z.object({ role: z.enum(["user", "pro", "admin"]), userId: z.uuid() }).strict(),
  z.object({ role: z.literal("system"), userId: z.uuid().nullable() }).strict(),
  z.object({ role: z.literal("anonymous"), userId: z.null() }).strict(),
]);

export type DatabaseContext = z.infer<typeof databaseContextSchema>;

export function parseDatabaseContext(input: unknown): DatabaseContext {
  const result = databaseContextSchema.safeParse(input);
  if (!result.success) throw new Error("Invalid database context");
  return result.data;
}
