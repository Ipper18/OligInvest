import { Decimal, toDecimal } from "@oliginvest/core";
import { alertMessages, formatMessage } from "@oliginvest/i18n";
import { z } from "zod";

const messageInput = z
  .object({
    ticker: z.string().max(30),
    instrumentId: z.uuid(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    type: z.enum(["price_above", "price_below", "change_pct"]),
    value: z.string().regex(/^-?\d+(\.\d+)?$/),
    threshold: z.string().regex(/^-?\d+(\.\d+)?$/),
    dataSource: z.enum(["gpw", "yahoo", "stooq_manual", "nbp", "ecb", "gpw_manual", "computed"]),
    dataAsOf: z.iso.datetime(),
    triggeredAt: z.iso.datetime(),
    delayMinutes: z.number().int().min(0),
  })
  .strict();
export function alertMessage(input: unknown, origin: string, timezone: string) {
  const value = messageInput.parse(input),
    percent = value.type === "change_pct";
  const display = (text: string) =>
    percent
      ? `${toDecimal(text).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2).replace(".", ",")} %`
      : `${toDecimal(text).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed().replace(".", ",")} ${value.currency}`;
  const date = (s: string) =>
    new Intl.DateTimeFormat("pl-PL", {
      timeZone: timezone,
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(s));
  const names = {
    yahoo: "Yahoo",
    gpw: "GPW",
    stooq_manual: "Stooq",
    nbp: "NBP",
    ecb: "ECB",
    gpw_manual: "GPW — import ręczny",
    computed: "dane obliczone",
  };
  return `${formatMessage(percent ? alertMessages.change : value.type === "price_above" ? alertMessages.priceAbove : alertMessages.priceBelow, { ticker: value.ticker, value: display(value.value), threshold: display(value.threshold) })} ${formatMessage(alertMessages.metadata, { triggeredAt: date(value.triggeredAt), dataAsOf: date(value.dataAsOf), delayMinutes: String(value.delayMinutes), source: names[value.dataSource], url: new URL(`/rynek/${value.instrumentId}`, origin).href })}`;
}
