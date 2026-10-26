type Preferences = { channels: { push: boolean; email: boolean }; emailFallback: boolean };
export function deliveryChannels(channels: readonly ("push" | "email")[], preferences: Preferences, pushAvailable: boolean): ("push" | "email")[] {
  const push = channels.includes("push") && preferences.channels.push;
  const email = preferences.channels.email && (channels.includes("email") ||
    (push && !pushAvailable && preferences.emailFallback));
  return [...(push && pushAvailable ? ["push" as const] : []), ...(email ? ["email" as const] : [])];
}

/** Minute iteration handles DST gaps and folds without converting wall time to UTC. */
export function quietUntil(now: string, timezone: string, quiet: { start: string; end: string } | null | undefined): string | null {
  if (!quiet || quiet.start === quiet.end) return null;
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const isQuiet = (instant: number) => {
    const local = formatter.format(new Date(instant));
    return quiet.start < quiet.end ? local >= quiet.start && local < quiet.end : local >= quiet.start || local < quiet.end;
  };
  const instant = Date.parse(now);
  if (!isQuiet(instant)) return null;
  for (let next = Math.floor(instant / 60_000) * 60_000 + 60_000; next <= instant + 172800_000; next += 60_000) {
    if (!isQuiet(next)) return new Date(next).toISOString();
  }
  throw new Error("QUIET_HOURS_INVALID");
}
