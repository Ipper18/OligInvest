import type { UiModuleDefinition } from "@oliginvest/platform/modules";
export const uiDefinition = {
  id: "education",
  nav: [{ href: "/nauka", labelKey: "nav.learn", permission: "education:use" }],
} satisfies UiModuleDefinition;
