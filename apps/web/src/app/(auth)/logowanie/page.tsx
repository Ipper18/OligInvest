import { messages as defaultMessages } from "@oliginvest/i18n";
import { getLocalization } from "@oliginvest/ui/localization-server";
import { AuthForm } from "../../../auth/form";
export async function generateMetadata() {
  const messages =
    ((await getLocalization()).copies["messages"] as typeof defaultMessages | undefined) ??
    defaultMessages;
  return { title: messages.app.signIn + " — " + messages.app.brand };
}
// A signed-in visitor never renders this page: `proxy.ts` redirects them with the validated
// `returnTo` (BL-613, ZAP 10044).
export default function Page() {
  return <AuthForm kind="signIn" />;
}
