"use client";
import { portfolioMessages as defaultM } from "@oliginvest/i18n";
import { Button, ErrorState } from "@oliginvest/ui";
import { useCopy } from "@oliginvest/ui/localization";
import { useQuery } from "@tanstack/react-query";
import { importRefreshInterval } from "./import-refresh";
import { useOnline } from "./online";
import { readResource } from "./read-action";
import type { ReadArgs, ReadKey, Resource } from "./resources";

export function useResource<K extends ReadKey>(
  userId: string,
  key: K,
  args: ReadArgs,
  initial: Resource<K>,
) {
  const online = useOnline();
  const query = useQuery<Resource<K>, Error>({
    queryKey: [
      userId,
      [
        "instrument",
        "chart",
        "indicators",
        "search",
        "benchmarks",
        "quotes",
        "marketStatus",
        "fx",
        "watchlist",
        "watchlists",
      ].includes(key)
        ? "market"
        : "portfolio",
      key,
      args,
    ],
    queryFn: () => readResource(key, args),
    initialData: initial,
    refetchInterval: (query) => importRefreshInterval(key, query.state.data),
    meta: { pollSeconds: key === "import" || key === "rows" ? 5 : 60 },
  });
  return { ...query, data: query.data ?? initial, unavailable: query.isError || !online };
}
export function QueryNotice({ failed, retry }: { failed: boolean; retry: () => unknown }) {
  const m = useCopy("portfolioMessages", defaultM);

  return failed ? (
    <ErrorState title={m.failed} action={<Button onClick={() => void retry()}>{m.retry}</Button>} />
  ) : null;
}
