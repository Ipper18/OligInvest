import { portfolioMessages as m } from "@oliginvest/i18n";
import { formPage } from "../../../../../portfolio/form-page";
export const metadata = { title: m.editTransaction };
export default async function Page({ params }: { params: Promise<{ transactionId: string }> }) {
  return formPage("transaction", (await params).transactionId);
}
