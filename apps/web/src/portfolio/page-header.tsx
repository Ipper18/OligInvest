import { commonMessages, portfolioMessages as m } from "@oliginvest/i18n";
import Link from "next/link";
import type { ReactNode } from "react";
import { FilterForm } from "./filter-form";
import type { Resource } from "./resources";
import { type PortfolioSection, portfolioSections } from "./sections";

// Phone-width section chips; on desktop the sidebar submenu lists the same pages.
export function PortfolioNav({ current }: { current: PortfolioSection }) {
  return (
    <nav className="oi-section-nav" aria-label={commonMessages.nav.portfolio}>
      {portfolioSections.map(([key, href]) => (
        <Link
          prefetch={false}
          key={key}
          href={href}
          aria-current={key === current ? "page" : undefined}
        >
          {m[key]}
        </Link>
      ))}
    </nav>
  );
}
/**
 * Page title with the account switch and the main action on the right. View, grouping and
 * other filters stay under "Opcje widoku"; all controls belong to one GET form.
 */
export function PortfolioHeader({
  title,
  current,
  action,
  filters,
  children,
}: {
  title: string;
  current?: PortfolioSection | undefined;
  action?: ReactNode;
  filters?: {
    accounts: Resource<"accounts">["data"];
    args: { accountId?: string | undefined; view?: string | undefined };
    view?: boolean;
  };
  children?: ReactNode;
}) {
  const head = (
    <>
      <div className="oi-page-head">
        <h1>{title}</h1>
        <div className="oi-page-actions">
          {filters && (
            <>
              <label className="oi-sr" htmlFor="account-switch">
                {m.account}
              </label>
              <select
                id="account-switch"
                className="oi-account-switch"
                name="accountId"
                defaultValue={filters.args.accountId ?? ""}
              >
                <option value="">{m.allAccounts}</option>
                {filters.accounts.map((account) => (
                  <option value={account.id} key={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </>
          )}
          {action}
        </div>
      </div>
      {current && <PortfolioNav current={current} />}
    </>
  );
  if (!filters) return head;
  return (
    <FilterForm>
      {head}
      <details className="oi-view-options">
        <summary>{m.viewOptions}</summary>
        <div className="oi-filters">
          {filters.view && (
            <label>
              {m.view}
              <select name="view" defaultValue={filters.args.view ?? "economic"}>
                <option value="economic">{m.economic}</option>
                <option value="tax">{m.tax}</option>
              </select>
            </label>
          )}
          {children}
          <button type="submit" className="oi-button">
            {m.apply}
          </button>
        </div>
      </details>
    </FilterForm>
  );
}
