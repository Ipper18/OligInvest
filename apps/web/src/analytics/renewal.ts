export function quotaRenewal(headers: Headers, receivedAt = Date.now()): string | undefined {
  const raw = headers.get("Retry-After");
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const seconds = Number(raw);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 90000) return undefined;
  const serverTime = Date.parse(headers.get("Date") ?? "");
  return new Date(
    (Number.isFinite(serverTime) ? serverTime : receivedAt) + seconds * 1000,
  ).toISOString();
}
