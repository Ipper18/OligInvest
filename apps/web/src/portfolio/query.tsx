"use client";
import { portfolioMessages as m } from "@oliginvest/i18n";
import { Button } from "@oliginvest/ui";
import { useQuery } from "@tanstack/react-query";
import { importRefreshInterval } from "./import-refresh";
import { readResource } from "./read-action";
import type { ReadArgs, ReadKey, Resource } from "./resources";
export function useResource<K extends ReadKey>(
  userId: string,
  key: K,
  args: ReadArgs,
  initial: Resource<K>,
) {
  const query = useQuery<Resource<K>, Error>({
    queryKey: [
      userId,
      key === "instrument" || key === "chart" || key === "search" ? "market" : "portfolio",
      key,
      args,
    ],
    queryFn: () => readResource(key, args),
    initialData: initial,
    refetchInterval: (query) => importRefreshInterval(key, query.state.data),
    meta: { pollSeconds: key === "import" || key === "rows" ? 5 : 60 },
  });
  return { ...query, data: query.data ?? initial };
}
export function QueryNotice({ failed, retry }: { failed: boolean; retry: () => unknown }) {
  return failed ? (
    <div role="alert">
      <p>{m.failed}</p>
      <Button onClick={() => void retry()}>{m.retry}</Button>
    </div>
  ) : null;
}
