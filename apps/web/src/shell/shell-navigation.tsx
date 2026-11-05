import { appMessages, commonMessages, portfolioMessages } from "@oliginvest/i18n";
import type { Me } from "../api/validation";
import { portfolioSections } from "../portfolio/sections";
import { uiModules } from "../ui-registry";
import { type IconName, NavIcon } from "./icons";
import { type NavItem, Navigation } from "./navigation";

type NavKey = keyof typeof commonMessages.nav & IconName;
// Items always shown in the phone bottom bar; the rest go under "Więcej".
const bottom = new Set<NavKey>(["start", "portfolio", "market", "alerts"]);
export function ShellNavigation({ me }: { me: Me }) {
  const entries: { key: NavKey; href: string }[] = [
    { key: "start", href: "/" },
    ...uiModules.flatMap((module) =>
      (module.nav ?? [])
        .filter(
          (item) =>
            me.features[`module.${module.id}`] !== false &&
            me.permissions.includes(item.permission),
        )
        .map((item) => ({ key: item.labelKey.replace(/^nav\./u, "") as NavKey, href: item.href })),
    ),
    { key: "settings", href: "/ustawienia" },
  ];
  const items: NavItem[] = entries.map(({ key, href }) => ({
    href,
    label: commonMessages.nav[key],
    icon: <NavIcon name={key} />,
    bottom: bottom.has(key),
    ...(key === "portfolio"
      ? {
          children: portfolioSections.map(([section, path]) => ({
            href: path,
            label: portfolioMessages[section],
          })),
        }
      : {}),
  }));
  return (
    <Navigation
      label={appMessages.navigation}
      items={items}
      more={{ label: commonMessages.nav.more, icon: <NavIcon name="more" /> }}
    />
  );
}
