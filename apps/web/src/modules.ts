import "server-only";

// Foundation DTOs enter the web application only through its composition root.
// Functional modules remain optional and are discovered by generate-ui-registry.
export {
  apiQuoteSchema,
  benchmarkSchema,
  chartSchema,
  fxResponseSchema,
  indicatorSeriesSchema,
  instrumentSchema,
  pageSchema,
  statusSchema,
  watchlistDetail,
  watchlistInput,
  watchlistItemInput,
  watchlistItemPatch,
  watchlistPatch,
  watchlistSchema,
} from "@oliginvest/mod-market/contracts";
export {
  accountInput,
  accountPatch,
  accountSchema,
  cashBalanceSchema,
  dayChangeResponse,
  importBatchPage,
  importBatchSchema,
  importCommitSchema,
  importRowPage,
  importRowSchema,
  importUploadSchema,
  lotPage,
  portfolioSummary,
  positionsResponse,
  realizedResponse,
  resolutionSchema,
  transactionInput,
  transactionPage,
  transactionPatch,
  transactionSchema,
} from "@oliginvest/mod-portfolio/contracts";
