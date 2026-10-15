import { messages } from "@oliginvest/i18n";
import type { SearchParams } from "../../portfolio/page";
import { summaryPage } from "../../portfolio/summary-page";
export const metadata = { title: messages.nav.start + " — " + messages.app.brand };
export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return summaryPage(searchParams);
}
