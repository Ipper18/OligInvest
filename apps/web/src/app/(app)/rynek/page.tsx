import { marketMessages as m } from "@oliginvest/i18n";
import { requireMe } from "../../../auth/session";
import { MarketNav } from "../../../market/navigation";
import { MarketOverview } from "../../../market/overview";
import { fetchResource } from "../../../portfolio/resources";

export default async function Page() {
  const me = await requireMe();
  const [benchmarks, status] = await Promise.all([
    fetchResource("benchmarks"),
    fetchResource("marketStatus"),
  ]);
  const quotes = benchmarks.data.length
    ? await fetchResource("quotes", { instrumentIds: benchmarks.data.map((b) => b.instrumentId) })
    : { data: [] };
  return (
    <section>
      <h1>{m.title}</h1>
      <MarketNav />
      {benchmarks.data.length ? (
        <MarketOverview
          userId={me.id}
          benchmarks={benchmarks.data}
          initialQuotes={quotes}
          initialStatus={status}
        />
      ) : (
        <p>{m.empty}</p>
      )}
    </section>
  );
}
