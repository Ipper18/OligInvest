import { expect, test } from "vitest";
import { approximateIp, clientIpResolver } from "../src/auth/client-ip.js";

test("only an explicitly trusted socket peer can provide a single client address", () => {
  const resolve = clientIpResolver(["192.0.2.0/24", "2001:db8::/32"]);
  expect(resolve("198.51.100.1", "203.0.113.2")).toBe("198.51.100.1");
  expect(resolve("192.0.2.5", "203.0.113.2")).toBe("203.0.113.2");
  expect(resolve("::ffff:192.0.2.5", "203.0.113.2")).toBe("203.0.113.2");
  expect(resolve("2001:db8::1", "2001:db8:1::2")).toBe("2001:db8:1::2");
  expect(resolve("192.0.2.5", "203.0.113.2, 198.51.100.1")).toBe("192.0.2.5");
  expect(resolve("192.0.2.5", "malformed")).toBe("192.0.2.5");
  expect(clientIpResolver([])("192.0.2.5", "203.0.113.2")).toBe("192.0.2.5");
  expect(() => clientIpResolver(["invalid/24"])).toThrow();
  expect(() => clientIpResolver(["192.0.2.0/33"])).toThrow();
});

test("device lists expose only approximate IPv4 and IPv6 networks", () => {
  expect(approximateIp("192.0.2.129")).toBe("192.0.2.0/24");
  expect(approximateIp("2001:db8:1234:5678::abcd")).toBe("2001:db8:1234::/48");
  expect(approximateIp("2001:db8::abcd")).toBe("2001:db8:0::/48");
  expect(approximateIp("invalid")).toBeUndefined();
});
