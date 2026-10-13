import { portfolioMessages as m } from "@oliginvest/i18n";
import { portfolioPage, type SearchParams } from "../../../portfolio/page";
export const metadata = { title: m.positions };
export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return portfolioPage("positions", searchParams);
}
