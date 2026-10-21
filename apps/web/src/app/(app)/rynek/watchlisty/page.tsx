import { marketMessages as m } from "@oliginvest/i18n";
import { requireMe } from "../../../../auth/session";
import { MarketNav } from "../../../../market/navigation";
import { WatchlistsScreen } from "../../../../market/watchlist-screen";
import { fetchResource } from "../../../../portfolio/resources";
export default async function Page() {
  const me = await requireMe();
  return (
    <section>
      <h1>{m.watchlists}</h1>
      <MarketNav />
      <WatchlistsScreen userId={me.id} initial={await fetchResource("watchlists")} />
    </section>
  );
}
