import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, uuid } from "drizzle-orm/pg-core";

// Compile/query-generation fixture only. It does not create tables or connect to PostgreSQL.
const spikeTable = pgTable("typescript_spike", { id: uuid().primaryKey() });
const db = drizzle.mock();

export function selectById(id: string) {
  return db.select().from(spikeTable).where(eq(spikeTable.id, id)).toSQL();
}
