import { portfolioMessages as m } from "@oliginvest/i18n";
import { notFound } from "next/navigation";
import { requireMe } from "../auth/session";
import type { SearchParams } from "./page";
import { PortfolioFilters, PortfolioNav } from "./presentation";
import { fetchResource, readArgs } from "./resources";
import { SummaryLive } from "./summary-live";
import { SummaryView } from "./summary-view";

export async function summaryPage(search: SearchParams) {
  const me = await requireMe();
  const raw = Object.fromEntries(Object.entries(await search).filter((entry) => entry[1] !== ""));
  const parsed = readArgs.safeParse(raw);
  if (!parsed.success) notFound();
  const args = parsed.data;
  args.view ??= me.preferences.plView;
  const [accounts, initial, initialDay] = await Promise.all([
    fetchResource("accounts"),
    fetchResource("summary", args),
    fetchResource("day", args.accountId ? { accountId: args.accountId } : {}),
  ]);
  return (
    <section>
      <h1>{m.start}</h1>
      <PortfolioNav />
      <PortfolioFilters accounts={accounts.data} args={args} view />
      <SummaryLive
        userId={me.id}
        args={args}
        accounts={accounts.data}
        initial={initial}
        initialDay={initialDay}
        fallback={<SummaryView data={initial} day={initialDay} />}
      />
    </section>
  );
}
