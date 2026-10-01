// pg_dump emits a random psql guard. Database names differ by test design.
// Preserve owners, ACLs, policies, comments and every SQL statement.
export function normalizeSchemaDump(dump, database) {
  if (!/^bl007_[a-z_]+$/.test(database)) throw new Error("Unexpected test database name");
  return dump
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => !/^\\(?:un)?restrict \S+$/.test(line))
    .map((line) => line.replaceAll(database, "bl007_database"))
    .join("\n")
    .trim();
}
