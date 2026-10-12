import type { UiModuleDefinition } from "@oliginvest/platform/modules";
export const uiDefinition = {
  id: "alerts",
  nav: [{ href: "/alerty", labelKey: "nav.alerts", permission: "alerts:manage" }],
} satisfies UiModuleDefinition;
