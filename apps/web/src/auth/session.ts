import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getApiClient } from "../api/server";
import { meSchema } from "../api/validation";
import { gatePath } from "./navigation";
export const getMe = cache(async () => {
  const client = await getApiClient();
  const result = await client.GET("/me");
  if (result.response.status === 401) return null;
  if (!result.response.ok) throw new Error("SESSION_UNAVAILABLE");
  return meSchema.parse(result.data);
});
export async function requireMe() {
  const me = await getMe();
  const path = gatePath(me);
  if (path) redirect(path);
  return me!;
}
