import { z } from "zod";
import { ProviderError } from "../contracts.js";
import { limitedText } from "../transport.js";

/** Observation of a FRED series in the series unit (DGS3MO: percent per year). */
export interface MacroObservation {
  readonly date: string;
  readonly value: string;
}
// https://fred.stlouisfed.org/docs/api/fred/series_observations.html (verified 2026-10-20):
// values are strings; a day without a value (US holiday) is reported as ".".
const observationsSchema = z.object({
  observations: z.array(
    z
      .object({
        realtime_start: z.iso.date(),
        realtime_end: z.iso.date(),
        date: z.iso.date(),
        value: z.union([z.literal("."), z.string().regex(/^-?\d{1,6}(\.\d{1,8})?$/)]),
      })
      .strict(),
  ),
});
export const FRED_ATTRIBUTION =
  "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.";
export class FredProvider {
  readonly meta = {
    id: "fred",
    capabilities: ["macroSeries"],
    markets: ["US"],
    quota: { perMinute: 10 },
    delayMinutes: 0,
    license: FRED_ATTRIBUTION,
  } as const;
  constructor(
    private readonly request: typeof fetch,
    private readonly apiKey: string,
  ) {
    // FRED keys are 32 lowercase alphanumerics; the key only ever travels in this query string.
    if (!/^[a-z0-9]{32}$/u.test(apiKey)) throw new Error("Invalid FRED API key");
  }
  async getObservations(seriesId: string, from: string, to: string): Promise<MacroObservation[]> {
    if (!/^[A-Z0-9]{1,30}$/u.test(seriesId)) throw new Error("Invalid FRED series");
    z.iso.date().parse(from);
    z.iso.date().parse(to);
    if (from > to) throw new Error("Invalid range");
    const params = new URLSearchParams({
      series_id: seriesId,
      api_key: this.apiKey,
      file_type: "json",
      observation_start: from,
      observation_end: to,
    });
    const text = await limitedText(
      await this.request(`https://api.stlouisfed.org/fred/series/observations?${params}`),
      8_000_000,
    );
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ProviderError("provider_error");
    }
    const parsed = observationsSchema.safeParse(body);
    if (!parsed.success) throw new ProviderError("provider_error");
    return parsed.data.observations.flatMap((o) => {
      if (o.date < from || o.date > to) throw new ProviderError("provider_error");
      return o.value === "." ? [] : [{ date: o.date, value: o.value }];
    });
  }
}
