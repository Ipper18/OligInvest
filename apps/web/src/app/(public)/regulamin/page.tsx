import { messages } from "@oliginvest/i18n";
import { legalCopy } from "@oliginvest/i18n/legal";
import { PrintButton } from "@oliginvest/ui";
import Document from "../../../legal/terms.mdx";
export const metadata = { title: messages.app.terms };
export default function Page() {
  return (
    <article className="oi-legal">
      <h1>{messages.app.terms}</h1>
      <div className="oi-actions oi-print-hidden">
        <a href="/dokumenty/terms">{messages.app.download}</a>
        <PrintButton label={legalCopy.labels.print} />
      </div>
      <Document />
    </article>
  );
}
