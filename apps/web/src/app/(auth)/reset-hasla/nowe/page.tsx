import { messages as defaultMessages } from "@oliginvest/i18n";
import { getLocalization } from "@oliginvest/ui/localization-server";
import { AuthForm } from "../../../../auth/form";
export async function generateMetadata() {
  const messages =
    ((await getLocalization()).copies["messages"] as typeof defaultMessages | undefined) ??
    defaultMessages;
  return { title: messages.app.newPassword + " — " + messages.app.brand };
}
export default async function Page() {
  return <AuthForm kind="reset" />;
}
