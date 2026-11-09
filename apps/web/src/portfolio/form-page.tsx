import { portfolioMessages as defaultM } from "@oliginvest/i18n";
import { getLocalization } from "@oliginvest/ui/localization-server";
import { notFound } from "next/navigation";
import { requireMe } from "../auth/session";
import { AccountForm, TransactionForm } from "./forms";
import { PortfolioHeader } from "./page-header";
import { DomainError, fetchResource } from "./resources";
export async function formPage(kind: "account" | "transaction", id?: string) {
  const m =
    ((await getLocalization()).copies["portfolioMessages"] as typeof defaultM | undefined) ??
    defaultM;

  await requireMe();
  try {
    const initial = id ? await fetchResource(kind, { id }) : undefined;
    const title =
      kind === "account"
        ? id
          ? m.editAccount
          : m.newAccount
        : id
          ? m.editTransaction
          : m.newTransaction;
    return (
      <section>
        <PortfolioHeader title={title} current={kind === "account" ? "accounts" : "transactions"} />
        {kind === "account" ? (
          <AccountForm
            {...(initial
              ? { initial: initial as Awaited<ReturnType<typeof fetchResource<"account">>> }
              : {})}
          />
        ) : (
          <TransactionForm
            accounts={(await fetchResource("accounts")).data}
            {...(initial
              ? { initial: initial as Awaited<ReturnType<typeof fetchResource<"transaction">>> }
              : {})}
          />
        )}
      </section>
    );
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
