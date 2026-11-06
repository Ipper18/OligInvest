"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Labels and icons are prepared by the server (shell-navigation.tsx); the client only marks
// the current location, which keeps the shell bundle small.
export type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  bottom: boolean;
  children?: readonly { href: string; label: string }[];
};
// aria-current tokens: "page" for the current page, "true" for its section in the sidebar.
const PAGE = "page";
const SECTION = "true";
const within = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
export function Navigation({
  label,
  items,
  more,
}: {
  label: string;
  items: readonly NavItem[];
  more: { label: string; icon: ReactNode };
}) {
  const pathname = usePathname();
  const link = (item: NavItem, current: typeof PAGE | typeof SECTION = PAGE) => (
    <Link
      key={item.href}
      href={item.href}
      prefetch={false}
      aria-current={within(pathname, item.href) ? current : undefined}
    >
      {item.icon}
      <span>{item.label}</span>
    </Link>
  );
  return (
    <>
      <nav className="oi-sidebar" aria-label={label}>
        <ul>
          {items.map((item) => (
            <li key={item.href}>
              {link(item, item.children ? SECTION : PAGE)}
              {item.children && within(pathname, item.href) && (
                <ul className="oi-subnav">
                  {item.children.map((child) => (
                    <li key={child.href}>
                      <Link
                        href={child.href}
                        prefetch={false}
                        aria-current={
                          (
                            child.href === item.href
                              ? pathname === child.href
                              : within(pathname, child.href)
                          )
                            ? PAGE
                            : undefined
                        }
                      >
                        {child.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </nav>
      <nav className="oi-bottom-nav" aria-label={label}>
        {items.filter((item) => item.bottom).map((item) => link(item))}
        <details>
          <summary>
            {more.icon}
            <span>{more.label}</span>
          </summary>
          <div className="oi-more">
            {items.filter((item) => !item.bottom).map((item) => link(item))}
          </div>
        </details>
      </nav>
    </>
  );
}
