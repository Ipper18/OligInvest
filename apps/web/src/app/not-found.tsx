import { messages } from "@oliginvest/i18n";
import { PublicShell, ScreenState } from "@oliginvest/ui";
export default function NotFound() {
  return (
    <PublicShell>
      <ScreenState title={messages.app.notFound}>
        <a href="/">{messages.app.back}</a>
      </ScreenState>
    </PublicShell>
  );
}
