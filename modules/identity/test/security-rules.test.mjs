import { expect, test } from "vitest";
import {
  classifyDevice,
  deviceFamily,
  deviceKey,
  failedSignInAlertDue,
  massExportAnomaly,
  SECURITY_RULES,
} from "../src/domain/security-rules.js";

// Synthetic User-Agent strings; no real client data.
const agents = {
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  chromeWindowsUpdated:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  chromeIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
};

test("device family ignores versions and recognises Chromium forks and iOS browsers", () => {
  expect(deviceFamily(agents.chromeWindows)).toEqual({ browser: "chrome", system: "windows" });
  expect(deviceFamily(agents.edgeWindows)).toEqual({ browser: "edge", system: "windows" });
  expect(deviceFamily(agents.safariIphone)).toEqual({ browser: "safari", system: "ios" });
  expect(deviceFamily(agents.chromeIphone)).toEqual({ browser: "chrome", system: "ios" });
  expect(deviceFamily(agents.firefoxLinux)).toEqual({ browser: "firefox", system: "linux" });
  expect(deviceFamily(agents.chromeAndroid)).toEqual({ browser: "chrome", system: "android" });
  expect(deviceFamily(agents.safariMac)).toEqual({ browser: "safari", system: "macos" });
  expect(deviceFamily(undefined)).toEqual({ browser: "other", system: "other" });
  expect(deviceFamily("curl/8.0")).toEqual({ browser: "other", system: "other" });
  expect(deviceKey(agents.chromeWindows, "192.0.2.0/24")).toBe(
    deviceKey(agents.chromeWindowsUpdated, "192.0.2.0/24"),
  );
});

test("new device: baseline without history, known pair, new browser or new network", () => {
  const home = deviceKey(agents.chromeWindows, "192.0.2.0/24");
  expect(classifyDevice(home, [])).toBe("baseline");
  expect(classifyDevice(home, [home])).toBe("known");
  expect(classifyDevice(deviceKey(agents.firefoxLinux, "192.0.2.0/24"), [home])).toBe("new");
  // Phishing proxy: same forwarded User-Agent, different network.
  expect(classifyDevice(deviceKey(agents.chromeWindows, "198.51.100.0/24"), [home])).toBe("new");
  expect(classifyDevice(deviceKey(agents.chromeWindows, undefined), [home])).toBe("new");
});

test("failed sign-in series alerts at the threshold, once per cooldown", () => {
  const now = new Date("2026-11-13T10:00:00Z");
  const { threshold, cooldownMinutes } = SECURITY_RULES.failedSignIn;
  expect(threshold).toBe(5);
  expect(failedSignInAlertDue({ failures: threshold - 1, lastAlertAt: null, now })).toBe(false);
  expect(failedSignInAlertDue({ failures: threshold, lastAlertAt: null, now })).toBe(true);
  const recent = new Date(now.getTime() - (cooldownMinutes * 60_000 - 1));
  expect(failedSignInAlertDue({ failures: 50, lastAlertAt: recent, now })).toBe(false);
  const old = new Date(now.getTime() - cooldownMinutes * 60_000);
  expect(failedSignInAlertDue({ failures: threshold, lastAlertAt: old, now })).toBe(true);
});

test("mass export: more than three a day, or export with new PAT and new device", () => {
  const quiet = { patCreatedRecently: false, newDeviceRecently: false };
  expect(massExportAnomaly({ exportsLastDay: 3, ...quiet })).toBeNull();
  expect(massExportAnomaly({ exportsLastDay: 4, ...quiet })).toBe("volume");
  expect(
    massExportAnomaly({ exportsLastDay: 1, patCreatedRecently: true, newDeviceRecently: false }),
  ).toBeNull();
  expect(
    massExportAnomaly({ exportsLastDay: 1, patCreatedRecently: false, newDeviceRecently: true }),
  ).toBeNull();
  expect(
    massExportAnomaly({ exportsLastDay: 1, patCreatedRecently: true, newDeviceRecently: true }),
  ).toBe("combination");
});
