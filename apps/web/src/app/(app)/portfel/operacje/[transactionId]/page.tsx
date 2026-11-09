import { portfolioMessages as defaultM } from "@oliginvest/i18n";
import { getLocalization } from "@oliginvest/ui/localization-server";
import { formPage } from "../../../../../portfolio/form-page";
export async function generateMetadata() {
  const m =
    ((await getLocalization()).copies["portfolioMessages"] as typeof defaultM | undefined) ??
    defaultM;
  return { title: m.editTransaction };
}
export default async function Page({ params }: { params: Promise<{ transactionId: string }> }) {
  return formPage("transaction", (await params).transactionId);
}
