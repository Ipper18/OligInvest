import { portfolioMessages as m } from "@oliginvest/i18n";
import { notFound } from "next/navigation";
import { requireMe } from "../auth/session";
import { AccountForm, TransactionForm } from "./forms";
import { PortfolioNav } from "./presentation";
import { DomainError, fetchResource } from "./resources";
export async function formPage(kind: "account" | "transaction", id?: string) {
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
        <h1>{title}</h1>
        <PortfolioNav />
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
