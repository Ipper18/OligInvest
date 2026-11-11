import { messages as defaultMessages } from "@oliginvest/i18n";
import { legalCopy as defaultLegalCopy } from "@oliginvest/i18n/legal";
import { PrintButton } from "@oliginvest/ui";
import { useCopy } from "@oliginvest/ui/localization";
import { getLocalization } from "@oliginvest/ui/localization-server";
import Document from "../../../legal/sources.mdx";
export async function generateMetadata() {
  const messages =
    ((await getLocalization()).copies["messages"] as typeof defaultMessages | undefined) ??
    defaultMessages;
  return { title: messages.app.sources };
}
export default function Page() {
  const messages = useCopy("messages", defaultMessages);
  const legalCopy = useCopy("legalCopy", defaultLegalCopy);

  return (
    <article className="oi-legal">
      <h1>{messages.app.sources}</h1>
      <div className="oi-actions oi-print-hidden">
        <a href="/dokumenty/sources">{messages.app.download}</a>
        <PrintButton label={legalCopy.labels.print} />
      </div>
      <Document copy={legalCopy} />
    </article>
  );
}
