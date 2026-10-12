import { messages } from "@oliginvest/i18n";
import { Settings } from "../../../appearance/settings";
import { requireMe } from "../../../auth/session";
export const metadata = { title: messages.nav.settings + " — " + messages.app.brand };
export default async function Page() {
  const me = await requireMe();
  return (
    <>
      <h1>{messages.nav.settings}</h1>
      <Settings preferences={me.preferences} />
    </>
  );
}
