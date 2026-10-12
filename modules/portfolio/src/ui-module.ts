import type { UiModuleDefinition } from "@oliginvest/platform/modules";
export const uiDefinition = {
  id: "portfolio",
  nav: [{ href: "/portfel", labelKey: "nav.portfolio", permission: "portfolio:read" }],
} satisfies UiModuleDefinition;
