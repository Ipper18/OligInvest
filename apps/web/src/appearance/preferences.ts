import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { z } from "zod";

const preferenceSchema = z
  .object({
    theme: z.enum(["dark", "light", "system"]).catch("dark"),
    palette: z.enum(["standard", "colorblind"]).catch("standard"),
  })
  .strict();

export const getTestPreferences = cache(async () => {
  const jar = await cookies();
  return preferenceSchema.parse({
    theme: jar.get("oi-test-theme")?.value,
    palette: jar.get("oi-test-palette")?.value,
  });
});
