import { notFound } from "next/navigation";
import { z } from "zod";
import { requireMe } from "../../../../../auth/session";
import { MarketNav } from "../../../../../market/navigation";
import { WatchlistScreen } from "../../../../../market/watchlist-screen";
import { DomainError, fetchResource } from "../../../../../portfolio/resources";
export default async function Page({ params }: { params: Promise<{ watchlistId: string }> }) {
  const me = await requireMe(),
    parsed = z.uuid().safeParse((await params).watchlistId);
  if (!parsed.success) notFound();
  try {
    return (
      <section>
        <MarketNav />
        <WatchlistScreen
          userId={me.id}
          initial={await fetchResource("watchlist", { id: parsed.data })}
        />
      </section>
    );
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
