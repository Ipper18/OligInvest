import { portfolioMessages as defaultM } from "@oliginvest/i18n";
import { getLocalization } from "@oliginvest/ui/localization-server";
import { portfolioPage, type SearchParams } from "../../../../portfolio/page";
export async function generateMetadata() {
  const m =
    ((await getLocalization()).copies["portfolioMessages"] as typeof defaultM | undefined) ??
    defaultM;
  return { title: m.transactions };
}
export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return portfolioPage("transactions", searchParams);
}
