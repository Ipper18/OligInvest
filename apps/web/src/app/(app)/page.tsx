import { messages } from "@oliginvest/i18n";
import { portfolioPage, type SearchParams } from "../../portfolio/page";
export const metadata = { title: messages.nav.start + " — " + messages.app.brand };
export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return portfolioPage("summary", searchParams);
}
