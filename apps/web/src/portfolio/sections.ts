// Portfolio subpages, shared by the sidebar submenu and the phone section chips.
export const portfolioSections = [
  ["positions", "/portfel"],
  ["transactions", "/portfel/operacje"],
  ["imports", "/portfel/import"],
  ["accounts", "/portfel/rachunki"],
  ["lots", "/portfel/partie"],
  ["realized", "/portfel/wyniki"],
  ["allocation", "/portfel/alokacja"],
] as const;
export type PortfolioSection = (typeof portfolioSections)[number][0];
