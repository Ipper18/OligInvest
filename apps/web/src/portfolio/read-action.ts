"use server";
import { requireMe } from "../auth/session";
import { fetchResource, type ReadArgs, type ReadKey } from "./resources";

export async function readResource<K extends ReadKey>(key: K, args: ReadArgs = {}) {
  await requireMe();
  return fetchResource(key, args);
}
