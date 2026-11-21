// BL-112: one entry for administrators only; the web pages check the role again on the server.
// Static metadata read by scripts/generate-ui-registry.mjs (shape: UiModuleDefinition, platform).
export const uiDefinition = {
  id: "admin",
  nav: [{ href: "/admin", labelKey: "nav.admin", permission: "admin:users" }],
};
