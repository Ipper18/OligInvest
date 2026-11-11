import { messages as defaultMessages } from "@oliginvest/i18n";
import { getLocalization } from "@oliginvest/ui/localization-server";
import { z } from "zod";
import { getApiClient } from "../../../api/server";
import { Settings } from "../../../appearance/settings";
import { requireMe } from "../../../auth/session";
import { SignOutButton } from "../../../auth/sign-out-button";
import { PushSettings } from "../../../pwa/push-settings";
export async function generateMetadata() {
  const messages =
    ((await getLocalization()).copies["messages"] as typeof defaultMessages | undefined) ??
    defaultMessages;
  return { title: messages.nav.settings + " — " + messages.app.brand };
}
export default async function Page() {
  const messages =
    ((await getLocalization()).copies["messages"] as typeof defaultMessages | undefined) ??
    defaultMessages;

  const me = await requireMe();
  const result = await (await getApiClient()).GET("/notifications/push-config");
  const publicKey = result.response.ok
    ? z.object({ publicKey: z.string().nullable() }).strict().parse(result.data).publicKey
    : null;
  return (
    <>
      <h1>{messages.nav.settings}</h1>
      <Settings preferences={me.preferences} userId={me.id} />
      <PushSettings publicKey={publicKey} />
      <section aria-labelledby="account-heading" className="oi-form">
        <h2 id="account-heading">{messages.app.accountSection}</h2>
        <div>
          <SignOutButton />
        </div>
      </section>
    </>
  );
}
