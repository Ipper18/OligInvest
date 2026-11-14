import { z } from "zod";

/** BullMQ queue of the identity module (BL-114): GDPR exports and the daily account erasure. */
export const IDENTITY_QUEUE = "identity";
export const DATA_EXPORT_JOB = "identity.export";
export const ACCOUNT_ERASURE_JOB = "identity.erasure";

/** API → jobs. The job carries identifiers only; the worker reads data under the owner's RLS. */
export const dataExportJobSchema = z
  .object({ v: z.literal(1), exportId: z.uuid(), userId: z.uuid() })
  .strict();
export type DataExportJob = z.infer<typeof dataExportJobSchema>;

/** FR-07.09 limits, documented in prywatnosc-rodo.md § 7. */
export const GDPR_LIMITS = Object.freeze({
  /** Archive availability after it is ready (one download). */
  exportAvailableHours: 24,
  /** Hard cap; the mass-export rule (BL-110) alerts and requires a fresh step-up above 3 a day. */
  exportsPerDay: 10,
  /** A queued or running export older than this is treated as lost (worker crash) and failed. */
  exportStaleMinutes: 60,
  /** Grace period before the account is erased. */
  deletionGraceDays: 14,
});
