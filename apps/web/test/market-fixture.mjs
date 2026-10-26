// Synthetic data for the M2 browser boundary; no network provider calls.
export function marketFixture(path, url, send, instrumentId, instant) {
  if (path.endsWith("/indicators"))
    return send({
      instrumentId,
      interval: url.searchParams.get("interval") ?? "1d",
      t: [1791763200, 1791849600],
      indicators: url.searchParams.getAll("spec").map((spec) => ({
        spec,
        kind: ["sma", "ema", "bb"].includes(spec.split(":")[0]) ? "overlay" : "panel",
        outputs: { value: [null, 11.5] },
      })),
      meta: { source: "gpw", asOf: instant, delayMinutes: 0, stale: false },
    });
  if (path === "/market/benchmarks")
    return send({
      data: [
        {
          code: "SYNTH",
          name: "Benchmark syntetyczny",
          kind: "index",
          instrumentId,
          currency: "PLN",
          dataAvailableFrom: "2021-01-04",
        },
      ],
    });
  if (path === "/market/status")
    return send({
      asOf: instant,
      categories: [
        { key: "gpw_eod", status: "ok", lastSuccessAt: instant },
        { key: "intraday_us", status: "degraded", staleReason: "provider_error" },
      ],
    });
  if (path === "/market/quotes")
    return send({
      data: [
        {
          instrumentId,
          price: "12",
          currency: "PLN",
          changeRatio: -0.02,
          meta: {
            source: "gpw",
            asOf: instant,
            delayMinutes: 0,
            stale: false,
            qualityStatus: "WARN",
            attribution: "Źródło: GPW",
          },
        },
      ],
    });
  if (path === "/market/fx/rates") {
    const fallback = url.searchParams.get("currency") === "EUR";
    return send({
      quote: "PLN",
      series: [
        {
          currency: fallback ? "EUR" : "USD",
          items: [
            { date: "2026-10-13", rate: "4.1234", ...(fallback ? {} : { tableNo: "TEST/A/NBP" }) },
          ],
        },
      ],
      meta: {
        source: fallback ? "ecb" : "nbp",
        asOf: instant,
        delayMinutes: 0,
        stale: fallback,
        ...(fallback ? { staleReason: "provider_error" } : {}),
        attribution: fallback ? "EBC (Frankfurter)" : "NBP",
      },
    });
  }
  return false;
}
