import { portfolioMessages as defaultM } from "@oliginvest/i18n";
import { getLocalization } from "@oliginvest/ui/localization-server";
import { notFound } from "next/navigation";
import { requireMe } from "../auth/session";
import type { SearchParams } from "./page";
import { PortfolioHeader } from "./page-header";
import { fetchResource, readArgs } from "./resources";
import { SummaryLive } from "./summary-live";
import { SummaryTable } from "./summary-table";
import { SummaryView } from "./summary-view";

export async function summaryPage(search: SearchParams) {
  const m =
    ((await getLocalization()).copies["portfolioMessages"] as typeof defaultM | undefined) ??
    defaultM;

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
      <PortfolioHeader title={m.start} filters={{ accounts: accounts.data, args, view: true }} />
      <SummaryLive
        userId={me.id}
        args={args}
        accounts={accounts.data}
        initial={initial}
        initialDay={initialDay}
        fallback={<SummaryView data={initial} day={initialDay} Table={SummaryTable} />}
        offlineFallback={
          <SummaryView data={initial} day={initialDay} Table={SummaryTable} unavailable />
        }
      />
    </section>
  );
}
