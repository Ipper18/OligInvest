/**
 * Security anomaly rules (BL-110, NFR-03.10). Pure functions: the API feeds them
 * audit history read under the account's RLS context. Thresholds mirror
 * docs/06-bezpieczenstwo/kontrole-bezpieczenstwa.md § 5.3; change both together.
 */
export const SECURITY_RULES = Object.freeze({
  failedSignIn: Object.freeze({
    threshold: 5,
    windowMinutes: 15,
    cooldownMinutes: 60,
  }),
  newDevice: Object.freeze({ lookbackDays: 90 }),
  massExport: Object.freeze({
    maxExportsPerDay: 3,
    combinationWindowMinutes: 60,
    cooldownMinutes: 24 * 60,
  }),
});

export type BrowserFamily =
  | "edge"
  | "opera"
  | "samsung"
  | "firefox"
  | "chrome"
  | "safari"
  | "other";
export type SystemFamily = "ios" | "android" | "windows" | "macos" | "chromeos" | "linux" | "other";
export type DeviceFamily = { browser: BrowserFamily; system: SystemFamily };

// Order matters: Chromium forks also send "Chrome/", every iOS browser sends "Safari/".
const browsers: readonly (readonly [RegExp, BrowserFamily])[] = [
  [/\bEdg(?:e|A|iOS)?\//u, "edge"],
  [/\b(?:OPR|Opera|OPiOS)\//u, "opera"],
  [/\bSamsungBrowser\//u, "samsung"],
  [/\b(?:Firefox|FxiOS)\//u, "firefox"],
  [/\b(?:Chrome|CriOS|Chromium)\//u, "chrome"],
  [/\bVersion\/\d[\d.]*.*\bSafari\//u, "safari"],
];
const systems: readonly (readonly [RegExp, SystemFamily])[] = [
  [/\b(?:iPhone|iPad|iPod)\b/u, "ios"],
  [/\bAndroid\b/u, "android"],
  [/\bWindows\b/u, "windows"],
  [/\b(?:Macintosh|Mac OS X)\b/u, "macos"],
  [/\bCrOS\b/u, "chromeos"],
  [/\bLinux\b/u, "linux"],
];

/** Coarse browser and OS family; versions are ignored so updates are not "new devices". */
export function deviceFamily(userAgent: string | null | undefined): DeviceFamily {
  const value = (userAgent ?? "").slice(0, 512);
  return {
    browser: browsers.find(([pattern]) => pattern.test(value))?.[1] ?? "other",
    system: systems.find(([pattern]) => pattern.test(value))?.[1] ?? "other",
  };
}

/**
 * Device key = browser family + OS family + network prefix (/24 IPv4, /48 IPv6).
 * Either part changing counts as new: a real-time phishing proxy forwards the
 * victim's User-Agent, so only the network differs (THR T-ID-02).
 */
export function deviceKey(userAgent: string | null | undefined, network: string | undefined) {
  const family = deviceFamily(userAgent);
  return `${family.browser}/${family.system}@${network ?? "unknown"}`;
}

export type DeviceClassification = "baseline" | "known" | "new";
/** Empty history = first sign-in (or first after rollout): baseline, no e-mail. */
export function classifyDevice(current: string, history: readonly string[]): DeviceClassification {
  if (history.length === 0) return "baseline";
  return history.includes(current) ? "known" : "new";
}

/**
 * `failures` counts failed password and second-factor attempts within the window,
 * including the current one. One e-mail per cooldown, however long the series.
 */
export function failedSignInAlertDue(input: {
  failures: number;
  lastAlertAt: Date | null;
  now: Date;
}): boolean {
  const rule = SECURITY_RULES.failedSignIn;
  if (input.failures < rule.threshold) return false;
  return (
    input.lastAlertAt === null ||
    input.now.getTime() - input.lastAlertAt.getTime() >= rule.cooldownMinutes * 60_000
  );
}

export type MassExportReason = "volume" | "combination";
/**
 * Extension point for BL-114 (GDPR export). `exportsLastDay` includes the current
 * request; the combination is export + new PAT + new device within one hour.
 */
export function massExportAnomaly(input: {
  exportsLastDay: number;
  patCreatedRecently: boolean;
  newDeviceRecently: boolean;
}): MassExportReason | null {
  if (input.exportsLastDay > SECURITY_RULES.massExport.maxExportsPerDay) return "volume";
  if (input.patCreatedRecently && input.newDeviceRecently) return "combination";
  return null;
}
