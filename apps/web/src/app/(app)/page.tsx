import { messages as defaultMessages } from "@oliginvest/i18n";
import { getLocalization } from "@oliginvest/ui/localization-server";
import type { SearchParams } from "../../portfolio/page";
import { summaryPage } from "../../portfolio/summary-page";
export async function generateMetadata() {
  const messages =
    ((await getLocalization()).copies["messages"] as typeof defaultMessages | undefined) ??
    defaultMessages;
  return { title: messages.nav.start + " — " + messages.app.brand };
}
export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return summaryPage(searchParams);
}
