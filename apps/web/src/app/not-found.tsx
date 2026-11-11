import { messages as defaultMessages } from "@oliginvest/i18n";
import { PublicShell, ScreenState } from "@oliginvest/ui";
import { useCopy } from "@oliginvest/ui/localization";
export default function NotFound() {
  const messages = useCopy("messages", defaultMessages);

  return (
    <PublicShell>
      <ScreenState title={messages.app.notFound}>
        <a href="/">{messages.app.back}</a>
      </ScreenState>
    </PublicShell>
  );
}
