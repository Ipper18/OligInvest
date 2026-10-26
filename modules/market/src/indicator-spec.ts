import { z } from "zod";

export const INDICATOR_PATTERN =
  /^(sma|ema|rsi|atr):\d{1,3}$|^bb:\d{1,3}:\d(\.\d)?$|^macd:\d{1,3}:\d{1,3}:\d{1,3}$/;
export const indicatorSpec = z
  .string()
  .regex(INDICATOR_PATTERN)
  .refine((value) => {
    const [name, ...parts] = value.split(":");
    const periods = name === "bb" ? parts.slice(0, 1) : parts;
    return (
      periods.every((part) => Number(part) > 0) &&
      (name !== "macd" || Number(parts[0]) < Number(parts[1]))
    );
  });
