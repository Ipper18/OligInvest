import { z } from "zod";

const rate = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .nullable();
export const returnFiguresSchema = z
  .object({
    twr: rate,
    twrAnnualized: rate.optional(),
    xirr: rate.optional(),
    xirrStatus: z
      .enum(["ok", "no_convergence", "insufficient_flows", "period_too_short"])
      .optional(),
  })
  .strict();
export type ReturnFigures = z.infer<typeof returnFiguresSchema>;
