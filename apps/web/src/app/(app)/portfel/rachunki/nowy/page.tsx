import { portfolioMessages as m } from "@oliginvest/i18n";
import { formPage } from "../../../../../portfolio/form-page";
export const metadata = { title: m.newAccount };
export default function Page() {
  return formPage("account");
}
