"use client";
import { appMessages, commonMessages } from "@oliginvest/i18n";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Me } from "../api/validation";

import { uiModules } from "../ui-registry";

const links = uiModules.flatMap((module) =>
  (module.nav ?? []).map((item) => ({
    id: module.id,
    href: item.href,
    permission: item.permission,
    label: item.labelKey.replace(/^nav\./u, "") as keyof typeof commonMessages.nav,
  })),
);
export function Navigation({ me }: { me: Me }) {
  const pathname = usePathname();
  const items = [
    { href: "/", label: "start" as const },
    ...links.filter(
      (item) =>
        me.features[`module.${item.id}`] !== false && me.permissions.includes(item.permission),
    ),
    { href: "/ustawienia", label: "settings" as const },
    ...(me.role === "admin" ? [{ href: "/admin", label: "admin" as const }] : []),
  ];
  const link = (item: (typeof items)[number]) => (
    <Link
      key={item.href}
      href={item.href}
      prefetch={false}
      aria-current={
        (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)) ? "page" : undefined
      }
    >
      {commonMessages.nav[item.label]}
    </Link>
  );
  return (
    <>
      <nav className="oi-sidebar" aria-label={appMessages.navigation}>
        {items.map(link)}
      </nav>
      <nav className="oi-bottom-nav" aria-label={appMessages.navigation}>
        {items
          .filter((i) => ["start", "portfolio", "market", "alerts"].includes(i.label))
          .map(link)}
        <details>
          <summary>{commonMessages.nav.more}</summary>
          <div className="oi-more">
            {items
              .filter((i) => !["start", "portfolio", "market", "alerts"].includes(i.label))
              .map(link)}
          </div>
        </details>
      </nav>
    </>
  );
}
