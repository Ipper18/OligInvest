// BEGIN OPTIONAL EDUCATION
export { mountEducation } from "@oliginvest/mod-education/server";
// END OPTIONAL EDUCATION

export {
  authAccounts,
  authApiKeys,
  authRateLimits,
  authSessions,
  authTwoFactors,
  authUsers,
  authVerifications,
} from "@oliginvest/mod-identity/server";
export {
  type MarketDependencies,
  MarketRepository,
  marketError,
  mountMarket,
} from "@oliginvest/mod-market/server";
export {
  enqueuePortfolioRecompute,
  ImportRepository,
  livePortfolioValuation,
  mountPortfolio,
  type PortfolioDependencies,
  PortfolioRepository,
} from "@oliginvest/mod-portfolio/server";

/**
 * Optional functional modules (moduly.md § 2): declared only in `optionalDependencies` and loaded
 * only here. A build without the package (CI "build without <module>") mounts nothing for it.
 */
async function optionalModule<T>(load: () => Promise<T>): Promise<T | undefined> {
  try {
    return await load();
  } catch (error) {
    if ((error as { code?: unknown }).code === "ERR_MODULE_NOT_FOUND") return undefined;
    throw error;
  }
}
export const analyticsModule = await optionalModule(
  // biome-ignore lint/suspicious/noTsIgnore: TS2307 is expected only in a build without analytics.
  // @ts-ignore
  () => import("@oliginvest/mod-analytics/server"),
);
type AnalyticsModule = NonNullable<typeof analyticsModule>;
// Without the package the import is `any`; the host then still type-checks its own callbacks.
type Absent<T> = 0 extends 1 & T ? true : false;
export type AnalyticsDependencies =
  Absent<AnalyticsModule> extends true
    ? {
        repository(): unknown;
        authorize(request: Request): Promise<import("@oliginvest/db").DatabaseContext>;
        assertOrigin(request: Request): void | Promise<void>;
      }
    : Parameters<AnalyticsModule["mountAnalytics"]>[1];
export type AnalyticsRepository =
  Absent<AnalyticsModule> extends true
    ? unknown
    : InstanceType<AnalyticsModule["AnalyticsRepository"]>;
