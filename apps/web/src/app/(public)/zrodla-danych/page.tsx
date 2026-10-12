import { messages } from "@oliginvest/i18n";
import { legalCopy } from "@oliginvest/i18n/legal";
import { PrintButton } from "@oliginvest/ui";
import Document from "../../../legal/sources.mdx";
export const metadata = { title: messages.app.sources };
export default function Page() {
  return (
    <article className="oi-legal">
      <h1>{messages.app.sources}</h1>
      <div className="oi-actions oi-print-hidden">
        <a href="/dokumenty/sources">{messages.app.download}</a>
        <PrintButton label={legalCopy.labels.print} />
      </div>
      <Document />
    </article>
  );
}
