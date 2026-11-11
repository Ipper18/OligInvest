"use client";

import type { AnalyticsRunView } from "@oliginvest/contracts";
import { analyticsMessages as defaultM } from "@oliginvest/i18n/analytics";
import { useCopy } from "@oliginvest/ui/localization";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { refreshRun } from "./actions";

export function LiveRun({ initial, userId }: { initial: AnalyticsRunView; userId: string }) {
  const m = useCopy("analyticsMessages", defaultM);

  const router = useRouter();
  const query = useQuery({
    queryKey: [userId, "analytics", initial.id],
    queryFn: () => refreshRun(initial.id),
    initialData: initial,
    retry: false,
    refetchInterval: (q) =>
      ["running", "queued"].includes(q.state.data?.status ?? "") ? 60000 : false,
  });
  useEffect(() => {
    if (query.data.progress !== initial.progress || query.data.status !== initial.status)
      router.refresh();
  }, [query.data.progress, query.data.status, initial.progress, initial.status, router]);
  return query.isError ? <p role="status">{m.refreshFailed}</p> : null;
}
