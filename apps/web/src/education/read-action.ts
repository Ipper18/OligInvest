"use server";
import { z } from "zod";
import { requireMe } from "../auth/session";
import { entries } from "./catalog";
export async function readExplainer(key: string) {
  const me = await requireMe();
  if (me.features["module.education"] === false || !me.permissions.includes("education:use"))
    return null;
  const valid = z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/)
    .parse(key);
  return entries.find((entry) => entry.key === valid) ?? null;
}
