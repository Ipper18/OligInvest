"use server";
import { z } from "zod";
import { requireMe } from "../auth/session";
import { domainRequest } from "../portfolio/resources";

const state = z
  .object({
    step: z.string(),
    updatedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }).optional(),
    skippedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
const update = z
  .object({
    action: z.enum(["advance", "complete", "skip", "restart"]),
    step: z
      .string()
      .regex(/^[a-z0-9-]{2,40}$/)
      .optional(),
  })
  .strict();
export async function onboardingAction(input?: z.infer<typeof update>) {
  const me = await requireMe();
  if (me.features["module.education"] === false || !me.permissions.includes("education:use"))
    throw new Error("NOT_FOUND");
  const response = await domainRequest(
    "/education/onboarding",
    input
      ? {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update.parse(input)),
        }
      : {},
  );
  return state.parse(response);
}
