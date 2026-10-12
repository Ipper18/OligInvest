import { messages } from "@oliginvest/i18n";
import { ScreenState } from "@oliginvest/ui";
export const metadata = { title: messages.nav.start + " — " + messages.app.brand };
export default function Page() {
  return (
    <ScreenState title={messages.nav.start}>
      <p>{messages.app.shellReady}</p>
    </ScreenState>
  );
}
