import { messages } from "@oliginvest/i18n";
import { legalCopy } from "@oliginvest/i18n/legal";
import { PrintButton } from "@oliginvest/ui";
import Document from "../../../legal/privacy.mdx";
export const metadata = { title: messages.app.privacy };
export default function Page() {
  return (
    <article className="oi-legal">
      <h1>{messages.app.privacy}</h1>
      <div className="oi-actions oi-print-hidden">
        <a href="/dokumenty/privacy">{messages.app.download}</a>
        <PrintButton label={legalCopy.labels.print} />
      </div>
      <Document />
    </article>
  );
}
