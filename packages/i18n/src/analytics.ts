import analytics from "./pl/analytics.json" with { type: "json" };
export const analyticsMessages = analytics;

// Persisted worker warnings predate localized UI. Match their entire source template so an
// unfamiliar warning remains visible verbatim; never guess a numeric value or drop a warning.
export function localizeWarning(code: string, message: string, target: Record<string, string>) {
  const source = (analytics.warningTemplates as Record<string, string>)[code];
  if (!source || !target[code] || source === target[code]) return message;
  const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = source.split("{value}").map(escapePattern).join("([0-9]+(?:[.,][0-9]+)?)");
  const match = new RegExp(`^${pattern}$`, "u").exec(message);
  return match ? target[code].replace("{value}", match[1] ?? "") : message;
}
