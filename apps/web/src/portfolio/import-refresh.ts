// A completion event can arrive before this screen subscribes to its query.
export function importRefreshInterval(key: string, data: unknown): number | false {
  if (key !== "import" || !data || typeof data !== "object" || !("status" in data)) return false;
  return data.status === "uploaded" || data.status === "parsing" ? 5000 : false;
}
