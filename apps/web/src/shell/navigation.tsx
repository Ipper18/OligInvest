"use client";
import { messages } from "@oliginvest/i18n";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Me } from "../api/validation";

const links = [
  { id: "portfolio", href: "/portfel", label: "portfolio", permission: "portfolio:read" },
  { id: "market", href: "/rynek", label: "market", permission: "market:read" },
  { id: "alerts", href: "/alerty", label: "alerts", permission: "alerts:manage" },
  { id: "analytics", href: "/analizy", label: "analytics", permission: "analytics:run:light" },
  { id: "education", href: "/nauka", label: "learn", permission: "education:use" },
] as const;
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
      {messages.nav[item.label]}
    </Link>
  );
  return (
    <>
      <nav className="oi-sidebar" aria-label={messages.app.navigation}>
        {items.map(link)}
      </nav>
      <nav className="oi-bottom-nav" aria-label={messages.app.navigation}>
        {items
          .filter((i) => ["start", "portfolio", "market", "alerts"].includes(i.label))
          .map(link)}
        <details>
          <summary>{messages.nav.more}</summary>
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
