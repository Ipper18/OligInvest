export { createMarketJobs, marketSchedules } from "@oliginvest/mod-market/jobs";
export { dispatchNotification } from "@oliginvest/mod-notifications/jobs";
export {evaluateAlerts,flushAlertEvents} from "@oliginvest/mod-alerts/jobs";
export { parseImport, portfolioDate, recomputePortfolio } from "@oliginvest/mod-portfolio/jobs";
export {
  enqueuePortfolioRecompute,
  ImportRepository,
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
export const analyticsJobs = await optionalModule(
  // biome-ignore lint/suspicious/noTsIgnore: TS2307 is expected only in a build without analytics.
  // @ts-ignore
  () => import("@oliginvest/mod-analytics/jobs"),
);
