import type { UiModuleDefinition } from "@oliginvest/platform/modules";
import definitions from "./ui-modules.json";

// Generated metadata is safe for navigation and the proxy; DTO validators stay on the server.
export const uiModules: readonly UiModuleDefinition[] = definitions;
