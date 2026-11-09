import { marketMessages as defaultM } from "@oliginvest/i18n";
import { getLocalization } from "@oliginvest/ui/localization-server";
import { requireMe } from "../../../../auth/session";
import { MarketNav } from "../../../../market/navigation";
import { WatchlistsScreen } from "../../../../market/watchlist-screen";
import { fetchResource } from "../../../../portfolio/resources";
export default async function Page() {
  const m =
    ((await getLocalization()).copies["marketMessages"] as typeof defaultM | undefined) ?? defaultM;

  const me = await requireMe();
  return (
    <section>
      <h1>{m.watchlists}</h1>
      <MarketNav />
      <WatchlistsScreen userId={me.id} initial={await fetchResource("watchlists")} />
    </section>
  );
}
