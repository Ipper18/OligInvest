"use server";

import { getApiClient } from "../api/server";
import { preferencesSchema } from "../api/validation";
import { requireMe } from "../auth/session";

export async function readPreferences() {
  await requireMe();
  const result = await (await getApiClient()).GET("/me/preferences");
  if (!result.response.ok) return null;
  return preferencesSchema.parse(result.data);
}
