import { marketMessages as defaultM } from "@oliginvest/i18n";
import { useCopy } from "@oliginvest/ui/localization";
import Link from "next/link";

export function MarketNav() {
  const m = useCopy("marketMessages", defaultM);

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
