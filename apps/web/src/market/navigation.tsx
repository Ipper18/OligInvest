import { marketMessages as m } from "@oliginvest/i18n";
import Link from "next/link";

export function MarketNav() {
  return (
    <nav className="oi-section-nav" aria-label={m.title}>
      <Link prefetch={false} href="/rynek/watchlisty">
        {m.watchlists}
      </Link>
      <Link prefetch={false} href="/rynek">
        {m.benchmarks}
      </Link>
      <Link prefetch={false} href="/rynek/waluty">
        {m.fx}
      </Link>
    </nav>
  );
}
