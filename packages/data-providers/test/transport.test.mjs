import { expect, test, vi } from "vitest";
import { createProviderFetch, limitedText } from "../dist/index.js";

test("transport denies Stooq, user URLs, credentials, ports and insecure requests before IO", async () => {
  const network = vi.fn();
  const request = createProviderFetch("OligInvest/0.0.0 (+https://invest.oligi.pl)", network);
  for (const url of [
    "https://stooq.pl/",
    "http://api.nbp.pl/",
    "https://api.nbp.pl:444/",
    "https://bad@api.nbp.pl/",
    "https://other.invalid/",
  ])
    await expect(request(url)).rejects.toThrow();
  expect(network).not.toHaveBeenCalled();
});
test("honest UA and no redirects; 429 is classified and never bypassed", async () => {
  const network = vi.fn(async () => new Response("limited", { status: 429 }));
  const request = createProviderFetch("OligInvest/0.0.0 (+https://invest.oligi.pl)", network);
  await expect(request("https://www.gpw.pl/archiwum-notowan")).rejects.toMatchObject({
    reason: "provider_quota",
    status: 429,
  });
  expect(network).toHaveBeenCalledTimes(1);
  expect(network.mock.calls[0][1]).toMatchObject({
    redirect: "error",
    headers: { "User-Agent": "OligInvest/0.0.0 (+https://invest.oligi.pl)" },
  });
});
test("streamed responses enforce size limit without trusting Content-Length", async () => {
  await expect(limitedText(new Response("x".repeat(101)), 100)).rejects.toThrow();
  expect(await limitedText(new Response("{}"), 100)).toBe("{}");
});
