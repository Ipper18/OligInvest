import type { UiModuleDefinition } from "@oliginvest/platform/modules";
export const uiDefinition = {
  id: "analytics",
  nav: [{ href: "/analizy", labelKey: "nav.analytics", permission: "analytics:run:light" }],
} satisfies UiModuleDefinition;
