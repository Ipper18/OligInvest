import type { QueryClient } from "@tanstack/react-query";
import type { ReadArgs, Resource } from "./resources";

type ValuationEvent = {
  accountIds: string[];
  valuationAsOf: string;
  reason: string;
  summary?: {
    totalValue: { amount: string; currency: string };
    dayChange: { amount: string; currency: string };
    dayChangeRatio: number;
    source: string;
  };
};

// The stream summary covers the whole portfolio. It cannot replace a filtered account view.
export function updatePortfolioCache(client: QueryClient, userId: string, event: ValuationEvent) {
  const patched = new Set<string>();
  for (const query of client.getQueryCache().findAll({ queryKey: [userId, "portfolio"] })) {
    const args = query.queryKey[3] as ReadArgs | undefined;
    if (args?.accountId && !event.accountIds.includes(args.accountId)) continue;
    const previous = query.state.data as Resource<"summary"> | undefined;
    if (
      event.reason === "quotes" &&
      event.summary &&
      query.queryKey[2] === "summary" &&
      !args?.accountId &&
      previous?.isComplete &&
      previous.totalValue.currency === event.summary.totalValue.currency
    ) {
      client.setQueryData(query.queryKey, {
        ...previous,
        totalValue: event.summary.totalValue,
        dayChange: event.summary.dayChange,
        dayChangeRatio: event.summary.dayChangeRatio,
      });
      patched.add(query.queryHash);
    }
  }
  void client.invalidateQueries({
    predicate: (query) => {
      if (
        query.queryKey[0] !== userId ||
        query.queryKey[1] !== "portfolio" ||
        patched.has(query.queryHash)
      )
        return false;
      const args = query.queryKey[3] as ReadArgs | undefined;
      return !args?.accountId || event.accountIds.includes(args.accountId);
    },
  });
}

export function updateImportCache(client: QueryClient, userId: string, importId: string) {
  void client.invalidateQueries({
    predicate: (query) => {
      if (query.queryKey[0] !== userId || query.queryKey[1] !== "portfolio") return false;
      if (query.queryKey[2] === "imports") return true;
      return (
        (query.queryKey[2] === "import" || query.queryKey[2] === "rows") &&
        (query.queryKey[3] as ReadArgs | undefined)?.id === importId
      );
    },
  });
}
