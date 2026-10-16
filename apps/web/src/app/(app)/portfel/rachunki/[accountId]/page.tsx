import { portfolioMessages as m } from "@oliginvest/i18n";
import { formPage } from "../../../../../portfolio/form-page";
export const metadata = { title: m.editAccount };
export default async function Page({ params }: { params: Promise<{ accountId: string }> }) {
  return formPage("account", (await params).accountId);
}
