import { messages } from "@oliginvest/i18n";
import { z } from "zod";
import { getApiClient } from "../../../api/server";
import { Settings } from "../../../appearance/settings";
import { requireMe } from "../../../auth/session";
import { PushSettings } from "../../../pwa/push-settings";
export const metadata = { title: messages.nav.settings + " — " + messages.app.brand };
export default async function Page() {
  const me = await requireMe();
  const result = await (await getApiClient()).GET("/notifications/push-config");
  const publicKey = result.response.ok
    ? z.object({ publicKey: z.string().nullable() }).strict().parse(result.data).publicKey
    : null;
  return (
    <>
      <h1>{messages.nav.settings}</h1>
      <Settings preferences={me.preferences} />
      <PushSettings publicKey={publicKey} />
    </>
  );
}
