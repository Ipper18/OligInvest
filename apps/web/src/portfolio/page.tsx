import { portfolioMessages as m } from "@oliginvest/i18n";
import { notFound } from "next/navigation";
import { requireMe } from "../auth/session";
import { PortfolioFilters, PortfolioNav } from "./presentation";
import { fetchResource, readArgs } from "./resources";
export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export async function portfolioPage(
  kind: "positions" | "transactions" | "accounts" | "lots" | "realized",
  search: SearchParams,
) {
  const me = await requireMe();
  const raw = Object.fromEntries(Object.entries(await search).filter((entry) => entry[1] !== ""));
  const parsed = readArgs.safeParse(raw);
  if (!parsed.success) notFound();
  const args = parsed.data;
  if (["positions", "realized"].includes(kind)) args.view ??= me.preferences.plView;
  const accounts = await fetchResource("accounts");
  const common = { userId: me.id, args, accounts: accounts.data };
  const { AccountsScreen, LotsScreen, PositionsScreen, RealizedScreen, TransactionsScreen } =
    await import("./screens");
  const screen =
    kind === "positions" ? (
      <PositionsScreen
        {...common}
        initial={await fetchResource("positions", args)}
        initialCash={
          await fetchResource("cash", args.accountId ? { accountId: args.accountId } : {})
        }
      />
    ) : kind === "transactions" ? (
      <TransactionsScreen {...common} initial={await fetchResource("transactions", args)} />
    ) : kind === "accounts" ? (
      <AccountsScreen {...common} initial={accounts} />
    ) : kind === "lots" ? (
      <LotsScreen {...common} initial={await fetchResource("lots", args)} />
    ) : (
      <RealizedScreen {...common} initial={await fetchResource("realized", args)} />
    );
  return (
    <section>
      <h1>{m[kind]}</h1>
      <PortfolioNav />
      {kind !== "accounts" && (
        <PortfolioFilters
          accounts={accounts.data}
          args={args}
          view={["positions", "realized"].includes(kind)}
        >
          {kind === "positions" && (
            <label>
              {m.groupBy}
              <select name="groupBy" defaultValue={args.groupBy ?? "account_instrument"}>
                <option value="account_instrument">{m.account_instrument}</option>
                <option value="instrument">{m.byInstrument}</option>
              </select>
            </label>
          )}
          {kind === "transactions" && (
            <label>
              {m.type}
              <select name="type" defaultValue={args.type ?? ""}>
                <option value="">{m.allTypes}</option>
                {Object.entries(m.types).map(([type, label]) => (
                  <option key={type} value={type}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === "lots" && (
            <label>
              {m.status}
              <select name="status" defaultValue={args.status ?? "open"}>
                {(["open", "closed", "all"] as const).map((s) => (
                  <option key={s} value={s}>
                    {m[s]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(kind === "transactions" || kind === "realized") && (
            <>
              <label>
                {m.from}
                <input type="date" name="from" defaultValue={args.from} />
              </label>
              <label>
                {m.to}
                <input type="date" name="to" defaultValue={args.to} />
              </label>
            </>
          )}
          {kind === "realized" && (
            <label>
              {m.groupBy}
              <select name="groupBy" defaultValue={args.groupBy ?? "month"}>
                {(["day", "month", "year", "instrument", "account"] as const).map((s) => (
                  <option key={s} value={s}>
                    {m[s]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </PortfolioFilters>
      )}
      {screen}
    </section>
  );
}
