import type { UiModuleDefinition } from "@oliginvest/platform/modules";
export const uiDefinition = {
  id: "market",
  nav: [{ href: "/rynek", labelKey: "nav.market", permission: "market:read" }],
} satisfies UiModuleDefinition;
